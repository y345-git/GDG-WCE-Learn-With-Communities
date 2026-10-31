import urllib.request
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup
from datetime import datetime
import database

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

def normalize_title(title):
    if not title:
        return ''
    # Replace non-breaking spaces, smart quotes, multiple whitespace
    cleaned = title.replace('\xa0', ' ').replace('’', "'").replace('“', '"').replace('”', '"')
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().lower()
    return cleaned

def scrape_single_profile(url, timeout=12):
    """
    Scrapes a Google Skills public profile URL and matches against target badges.
    Returns structured results.
    """
    if not url or not str(url).startswith('http'):
        return {
            'success': False,
            'page_title': '',
            'total_badges_on_profile': 0,
            'completed_badges': {},
            'extra_badges': [],
            'error': 'Invalid URL'
        }

    # Fetch target badges from DB
    target_badges_list = database.get_all_target_badges()
    target_map = {tb['normalized_name']: tb['name'] for tb in target_badges_list}
    
    # Try up to 2 times
    last_err = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                html = resp.read().decode('utf-8', errors='ignore')
            
            soup = BeautifulSoup(html, 'html.parser')
            title_tag = soup.find('title')
            page_title = title_tag.get_text(strip=True) if title_tag else ''
            
            badge_divs = soup.find_all(class_='profile-badge')
            
            completed_badges = {}
            extra_badges = []
            
            for b in badge_divs:
                title_el = b.find(class_='ql-title-medium')
                date_el = b.find(class_='ql-body-medium')
                img_el = b.find('img')
                badge_link_el = b.find('a', class_='badge-image')
                
                raw_title = title_el.get_text(strip=True) if title_el else ''
                date_str = date_el.get_text(strip=True) if date_el else ''
                img_src = img_el.get('src') if img_el else ''
                badge_href = badge_link_el.get('href') if badge_link_el else ''
                
                if not raw_title:
                    continue
                    
                norm = normalize_title(raw_title)
                
                if norm in target_map:
                    canonical_name = target_map[norm]
                    completed_badges[norm] = {
                        'title': canonical_name,
                        'normalized_name': norm,
                        'date': date_str,
                        'img': img_src,
                        'url': badge_href
                    }
                else:
                    # Non-target badge (ignore from 10-badge count, record as extra)
                    extra_badges.append({
                        'title': raw_title,
                        'date': date_str,
                        'img': img_src,
                        'url': badge_href
                    })
                    
            return {
                'success': True,
                'page_title': page_title,
                'total_badges_on_profile': len(badge_divs),
                'completed_badges': completed_badges,
                'extra_badges': extra_badges,
                'error': None
            }
        except Exception as e:
            last_err = str(e)
            time.sleep(1)
            
    return {
        'success': False,
        'page_title': '',
        'total_badges_on_profile': 0,
        'completed_badges': {},
        'extra_badges': [],
        'error': last_err or 'Failed after retries'
    }

class SyncManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.is_running = False
        self.stop_requested = False
        self.total = 0
        self.processed = 0
        self.success_count = 0
        self.error_count = 0
        self.current_user = ''
        self.start_time = None
        self.end_time = None
        self.worker_thread = None

    def get_status(self):
        with self.lock:
            elapsed = round(time.time() - self.start_time, 1) if self.start_time and self.is_running else 0
            pct = round((self.processed / self.total * 100), 1) if self.total > 0 else 0
            eta = round((elapsed / self.processed) * (self.total - self.processed), 1) if self.processed > 0 and self.is_running else 0
            
            return {
                'is_running': self.is_running,
                'total': self.total,
                'processed': self.processed,
                'percentage': pct,
                'success_count': self.success_count,
                'error_count': self.error_count,
                'current_user': self.current_user,
                'elapsed_seconds': elapsed,
                'eta_seconds': eta,
                'start_time': self.start_time,
                'end_time': self.end_time
            }

    def start_sync(self, participant_ids=None, max_workers=10):
        with self.lock:
            if self.is_running:
                return False, "Sync already running"
            self.is_running = True
            self.stop_requested = False
            self.processed = 0
            self.success_count = 0
            self.error_count = 0
            self.start_time = time.time()
            self.end_time = None
            self.current_user = 'Initializing...'

        self.worker_thread = threading.Thread(
            target=self._run_sync,
            args=(participant_ids, max_workers),
            daemon=True
        )
        self.worker_thread.start()
        return True, "Sync started"

    def stop_sync(self):
        with self.lock:
            if not self.is_running:
                return False, "No sync currently running"
            self.stop_requested = True
            return True, "Stop request received"

    def _run_sync(self, participant_ids=None, max_workers=10):
        conn = database.get_db_connection()
        if participant_ids:
            placeholders = ','.join('?' for _ in participant_ids)
            query = f"SELECT id, user_name, profile_url FROM participants WHERE id IN ({placeholders})"
            participants = conn.execute(query, participant_ids).fetchall()
        else:
            participants = conn.execute("SELECT id, user_name, profile_url FROM participants").fetchall()
        conn.close()

        with self.lock:
            self.total = len(participants)

        def worker(p_id, name, url):
            if self.stop_requested:
                return p_id, None
            res = scrape_single_profile(url)
            database.update_participant_scrape_result(p_id, res)
            return p_id, name, res

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_part = {
                executor.submit(worker, p['id'], p['user_name'], p['profile_url']): p
                for p in participants
            }

            for future in as_completed(future_to_part):
                if self.stop_requested:
                    break
                try:
                    result = future.result()
                    if result and len(result) == 3:
                        p_id, name, res = result
                        with self.lock:
                            self.processed += 1
                            self.current_user = name
                            if res and res.get('success'):
                                self.success_count += 1
                            else:
                                self.error_count += 1
                except Exception as e:
                    with self.lock:
                        self.processed += 1
                        self.error_count += 1

        with self.lock:
            self.is_running = False
            self.stop_requested = False
            self.end_time = time.time()
            self.current_user = 'Completed' if self.processed >= self.total else 'Stopped'

# Global sync manager instance
sync_manager = SyncManager()

def scrape_single_participant(participant_id):
    """Scrapes a single participant and updates DB immediately."""
    p = database.get_participant_by_id(participant_id)
    if not p:
        return {'success': False, 'error': 'Participant not found'}
    
    res = scrape_single_profile(p['profile_url'])
    database.update_participant_scrape_result(participant_id, res)
    return database.get_participant_by_id(participant_id)
