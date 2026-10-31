import sqlite3
import os
import json
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gdg_tracking.db')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Target Badges (the 10 workshop badges)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS target_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        normalized_name TEXT UNIQUE NOT NULL,
        url TEXT,
        course_type TEXT DEFAULT 'Skill Badge',
        credits_required INTEGER DEFAULT 0,
        badge_order INTEGER DEFAULT 0
    )
    ''')
    
    # Participants
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        profile_url TEXT NOT NULL,
        profile_status TEXT,
        developer_profile_url TEXT,
        access_code TEXT,
        redemption_status TEXT,
        milestone_original TEXT,
        current_milestone TEXT,
        completed_count INTEGER DEFAULT 0,
        total_profile_badges INTEGER DEFAULT 0,
        last_scraped_at TEXT,
        scrape_status TEXT DEFAULT 'pending', -- pending, success, error, scraping
        scrape_error TEXT
    )
    ''')
    
    # Participant Badges (only for the target badges completed by participant)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS participant_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER NOT NULL,
        badge_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        earned_date TEXT,
        badge_image_url TEXT,
        badge_url TEXT,
        scraped_at TEXT,
        FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE CASCADE,
        UNIQUE(participant_id, normalized_name)
    )
    ''')
    
    # Additional badges on profile (ignored from 10-badge count, but recorded for reference)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS participant_extra_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER NOT NULL,
        badge_name TEXT NOT NULL,
        earned_date TEXT,
        badge_image_url TEXT,
        scraped_at TEXT,
        FOREIGN KEY (participant_id) REFERENCES participants (id) ON DELETE CASCADE
    )
    ''')
    
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_part_email ON participants(user_email)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_part_count ON participants(completed_count)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_pb_part_id ON participant_badges(participant_id)')
    
    conn.commit()
    conn.close()

def calculate_milestone(completed_count):
    if completed_count >= 10:
        return 'Milestone 3'
    elif completed_count >= 5:
        return 'Milestone 2'
    elif completed_count >= 3:
        return 'Milestone 1'
    return 'No Milestone'

def get_all_target_badges():
    conn = get_db_connection()
    badges = conn.execute('SELECT * FROM target_badges ORDER BY badge_order ASC, id ASC').fetchall()
    conn.close()
    return [dict(b) for b in badges]

def get_participants(search='', milestone='', badge_filter='', sort_by='count_desc', limit=None, offset=0):
    conn = get_db_connection()
    query = '''
    SELECT p.*,
           GROUP_CONCAT(pb.badge_name, '|||') as completed_badge_names,
           (SELECT COUNT(*) FROM participant_extra_badges peb WHERE peb.participant_id = p.id) as extra_badges_count
    FROM participants p
    LEFT JOIN participant_badges pb ON p.id = pb.participant_id
    WHERE 1=1
    '''
    params = []
    
    if search:
        search_term = f"%{search.strip()}%"
        query += " AND (p.user_name LIKE ? OR p.user_email LIKE ? OR p.access_code LIKE ?)"
        params.extend([search_term, search_term, search_term])
        
    if milestone:
        if milestone == '10':
            query += " AND p.completed_count >= 10"
        elif milestone == 'milestone_3':
            query += " AND p.completed_count >= 10"
        elif milestone == 'milestone_2':
            query += " AND p.completed_count >= 5 AND p.completed_count < 10"
        elif milestone == 'milestone_1':
            query += " AND p.completed_count >= 3 AND p.completed_count < 5"
        elif milestone == 'in_progress':
            query += " AND p.completed_count >= 1 AND p.completed_count < 3"
        elif milestone == 'not_started':
            query += " AND p.completed_count = 0"
        else:
            query += " AND p.current_milestone = ?"
            params.append(milestone)
            
    if badge_filter:
        query += " AND p.id IN (SELECT participant_id FROM participant_badges WHERE normalized_name = ?)"
        params.append(badge_filter.strip().lower())
        
    query += " GROUP BY p.id"
    
    if sort_by == 'count_desc':
        query += " ORDER BY p.completed_count DESC, p.user_name ASC"
    elif sort_by == 'count_asc':
        query += " ORDER BY p.completed_count ASC, p.user_name ASC"
    elif sort_by == 'name_asc':
        query += " ORDER BY p.user_name ASC"
    elif sort_by == 'name_desc':
        query += " ORDER BY p.user_name DESC"
    elif sort_by == 'updated_desc':
        query += " ORDER BY p.last_scraped_at DESC NULLS LAST, p.completed_count DESC"
    else:
        query += " ORDER BY p.completed_count DESC, p.user_name ASC"
        
    if limit is not None:
        query += f" LIMIT {int(limit)} OFFSET {int(offset)}"
        
    rows = conn.execute(query, params).fetchall()
    conn.close()
    
    results = []
    for r in rows:
        d = dict(r)
        badge_names = d.get('completed_badge_names')
        d['completed_badges_list'] = badge_names.split('|||') if badge_names else []
        results.append(d)
        
    return results

def get_participant_by_id(participant_id):
    conn = get_db_connection()
    p = conn.execute('SELECT * FROM participants WHERE id = ?', (participant_id,)).fetchone()
    if not p:
        conn.close()
        return None
        
    part_dict = dict(p)
    
    # Get completed target badges
    badges = conn.execute('''
        SELECT * FROM participant_badges 
        WHERE participant_id = ?
        ORDER BY earned_date DESC
    ''', (participant_id,)).fetchall()
    part_dict['completed_badges'] = [dict(b) for b in badges]
    
    # Get extra badges (non-target badges)
    extra_badges = conn.execute('''
        SELECT * FROM participant_extra_badges
        WHERE participant_id = ?
        ORDER BY earned_date DESC
    ''', (participant_id,)).fetchall()
    part_dict['extra_badges'] = [dict(b) for b in extra_badges]
    
    conn.close()
    return part_dict

def update_participant_scrape_result(participant_id, scrape_result):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    if not scrape_result.get('success', False):
        cursor.execute('''
            UPDATE participants
            SET scrape_status = 'error',
                scrape_error = ?,
                last_scraped_at = ?
            WHERE id = ?
        ''', (scrape_result.get('error', 'Unknown error'), now_str, participant_id))
        conn.commit()
        conn.close()
        return
        
    completed_badges = scrape_result.get('completed_badges', {})
    completed_count = len(completed_badges)
    total_on_profile = scrape_result.get('total_badges_on_profile', 0)
    new_milestone = calculate_milestone(completed_count)
    
    # Update participants table
    cursor.execute('''
        UPDATE participants
        SET completed_count = ?,
            current_milestone = ?,
            total_profile_badges = ?,
            last_scraped_at = ?,
            scrape_status = 'success',
            scrape_error = NULL
        WHERE id = ?
    ''', (completed_count, new_milestone, total_on_profile, now_str, participant_id))
    
    # Replace completed badges for this participant
    cursor.execute('DELETE FROM participant_badges WHERE participant_id = ?', (participant_id,))
    for b_norm, b_data in completed_badges.items():
        cursor.execute('''
            INSERT INTO participant_badges 
            (participant_id, badge_name, normalized_name, earned_date, badge_image_url, badge_url, scraped_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            participant_id,
            b_data.get('title'),
            b_norm,
            b_data.get('date'),
            b_data.get('img'),
            b_data.get('url'),
            now_str
        ))
        
    # Replace extra badges
    cursor.execute('DELETE FROM participant_extra_badges WHERE participant_id = ?', (participant_id,))
    extra_badges = scrape_result.get('extra_badges', [])
    for eb in extra_badges:
        cursor.execute('''
            INSERT INTO participant_extra_badges
            (participant_id, badge_name, earned_date, badge_image_url, scraped_at)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            participant_id,
            eb.get('title'),
            eb.get('date'),
            eb.get('img'),
            now_str
        ))
        
    conn.commit()
    conn.close()

def get_stats():
    conn = get_db_connection()
    total_participants = conn.execute('SELECT COUNT(*) FROM participants').fetchone()[0]
    
    # Milestones breakdown
    m3_count = conn.execute('SELECT COUNT(*) FROM participants WHERE completed_count >= 10').fetchone()[0]
    m2_count = conn.execute('SELECT COUNT(*) FROM participants WHERE completed_count >= 5 AND completed_count < 10').fetchone()[0]
    m1_count = conn.execute('SELECT COUNT(*) FROM participants WHERE completed_count >= 3 AND completed_count < 5').fetchone()[0]
    in_prog_count = conn.execute('SELECT COUNT(*) FROM participants WHERE completed_count >= 1 AND completed_count < 3').fetchone()[0]
    unstarted_count = conn.execute('SELECT COUNT(*) FROM participants WHERE completed_count = 0').fetchone()[0]
    
    # Total badges earned
    total_target_badges_earned = conn.execute('SELECT COUNT(*) FROM participant_badges').fetchone()[0]
    
    # Badge by badge completion count
    target_badges = conn.execute('SELECT * FROM target_badges ORDER BY badge_order ASC').fetchall()
    badge_stats = []
    for tb in target_badges:
        cnt = conn.execute(
            'SELECT COUNT(*) FROM participant_badges WHERE normalized_name = ?',
            (tb['normalized_name'],)
        ).fetchone()[0]
        badge_stats.append({
            'name': tb['name'],
            'normalized_name': tb['normalized_name'],
            'url': tb['url'],
            'credits': tb['credits_required'],
            'completed_count': cnt,
            'percentage': round((cnt / total_participants * 100) if total_participants else 0, 1)
        })
        
    # Last scraped time
    last_scraped = conn.execute('SELECT MAX(last_scraped_at) FROM participants').fetchone()[0]
    
    conn.close()
    
    avg_badges = round((total_target_badges_earned / total_participants) if total_participants else 0, 2)
    avg_percentage = round((avg_badges / 10 * 100), 1)
    
    return {
        'total_participants': total_participants,
        'milestones': {
            'milestone_3': m3_count, # 10 badges
            'milestone_2': m2_count, # 5-9 badges
            'milestone_1': m1_count, # 3-4 badges
            'in_progress': in_prog_count, # 1-2 badges
            'not_started': unstarted_count # 0 badges
        },
        'total_target_badges_earned': total_target_badges_earned,
        'max_possible_badges': total_participants * 10,
        'average_badges_per_student': avg_badges,
        'average_percentage': avg_percentage,
        'badge_stats': badge_stats,
        'last_scraped_at': last_scraped
    }
