import urllib.request
import csv
import io
import os
import openpyxl
from datetime import datetime
import database
from scraper import normalize_title

GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVMEFW24yi5IVcBblZFEK5xMdQyeF9pndf-wxE37BKu5hyOghhSkYiCHW6rSLjNJd5U3OI_E_I9vZi/pub?gid=411469390&single=true&output=csv'

FALLBACK_TARGET_BADGES = [
    {"name": "The Basics of Google Cloud Compute", "url": "https://www.skills.google/course_templates/754", "credits": 4},
    {"name": "Configure Service Accounts and IAM Roles for Google Cloud", "url": "https://www.skills.google/course_templates/702", "credits": 4},
    {"name": "Implement Speech and Language Solutions with Pre-trained APIs", "url": "https://www.skills.google/course_templates/700", "credits": 4},
    {"name": "Develop AI-Powered Prototypes in Google AI Studio", "url": "https://www.skills.google/course_templates/1426", "credits": 0},
    {"name": "Analyze Images with the Cloud Vision API", "url": "https://www.skills.google/course_templates/633", "credits": 12},
    {"name": "Build a Website on Google Cloud", "url": "https://www.skills.google/course_templates/638", "credits": 13},
    {"name": "Create Your First Gemini Enterprise Application", "url": "https://www.skills.google/course_templates/1586/", "credits": 0},
    {"name": "Store, Process, and Manage Data on Google Cloud - Console", "url": "https://www.skills.google/course_templates/658", "credits": 3},
    {"name": "Using the Google Cloud Speech API", "url": "https://www.skills.google/course_templates/756", "credits": 4},
    {"name": "Explore Generative AI in Agent Platform", "url": "https://www.skills.google/course_templates/959", "credits": 16}
]

def load_target_badges_from_sheet():
    badges = []
    try:
        req = urllib.request.Request(GOOGLE_SHEET_CSV_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode('utf-8')
            reader = csv.DictReader(io.StringIO(content))
            for i, row in enumerate(reader, 1):
                name = row.get('Course Name', '').strip()
                if name:
                    badges.append({
                        'name': name,
                        'url': row.get('Course URL', '').strip(),
                        'course_type': row.get('Type of Course', 'Skill Badge').strip(),
                        'credits': int(row.get('# of credits required', 0) or 0),
                        'order': i
                    })
    except Exception as e:
        print(f"Warning: Could not fetch Google Sheet online ({e}). Using fallback list.")
        for i, b in enumerate(FALLBACK_TARGET_BADGES, 1):
            badges.append({
                'name': b['name'],
                'url': b['url'],
                'course_type': 'Skill Badge',
                'credits': b['credits'],
                'order': i
            })
    return badges

def seed_database(force_reload=False):
    database.init_db()
    conn = database.get_db_connection()
    cursor = conn.cursor()

    # Check if already seeded
    existing_part_count = cursor.execute('SELECT COUNT(*) FROM participants').fetchone()[0]
    if existing_part_count > 0 and not force_reload:
        print(f"Database already has {existing_part_count} participants. Skipping seed.")
        conn.close()
        return

    print("Seeding database...")

    # 1. Seed Target Badges
    cursor.execute('DELETE FROM target_badges')
    target_badges = load_target_badges_from_sheet()
    target_norm_map = {}
    for b in target_badges:
        norm = normalize_title(b['name'])
        target_norm_map[norm] = b['name']
        cursor.execute('''
            INSERT INTO target_badges (name, normalized_name, url, course_type, credits_required, badge_order)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (b['name'], norm, b['url'], b.get('course_type', 'Skill Badge'), b['credits'], b['order']))

    # 2. Seed Participants from Excel
    excel_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'GDGC-WCE01.xlsx')
    if not os.path.exists(excel_path):
        print(f"Error: {excel_path} not found!")
        conn.close()
        return

    wb = openpyxl.load_workbook(excel_path)
    sheet = wb['Sheet1']
    
    cursor.execute('DELETE FROM participant_badges')
    cursor.execute('DELETE FROM participant_extra_badges')
    cursor.execute('DELETE FROM participants')

    seeded_count = 0
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    for r in range(2, sheet.max_row + 1):
        name = sheet.cell(r, 1).value
        email = sheet.cell(r, 2).value
        profile_url = sheet.cell(r, 3).value
        profile_status = sheet.cell(r, 4).value
        dev_url = sheet.cell(r, 5).value
        access_code = sheet.cell(r, 7).value
        redemption_status = sheet.cell(r, 8).value
        milestone_orig = sheet.cell(r, 9).value or 'No Milestone'
        excel_count = sheet.cell(r, 11).value
        excel_badge_names = sheet.cell(r, 12).value

        if not name or not profile_url:
            continue

        try:
            cnt_val = int(float(excel_count)) if excel_count is not None else 0
        except:
            cnt_val = 0

        milestone_calc = database.calculate_milestone(cnt_val)

        cursor.execute('''
            INSERT INTO participants (
                user_name, user_email, profile_url, profile_status, developer_profile_url,
                access_code, redemption_status, milestone_original, current_milestone,
                completed_count, total_profile_badges, last_scraped_at, scrape_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            str(name).strip(),
            str(email).strip() if email else '',
            str(profile_url).strip(),
            str(profile_status).strip() if profile_status else 'All Good',
            str(dev_url).strip() if dev_url else 'Not applicable',
            str(access_code).strip() if access_code else '',
            str(redemption_status).strip() if redemption_status else 'No',
            str(milestone_orig).strip(),
            milestone_calc,
            cnt_val,
            cnt_val, # baseline profile count
            now_str if cnt_val > 0 else None,
            'success' if cnt_val > 0 else 'pending'
        ))

        p_id = cursor.lastrowid
        seeded_count += 1

        # Pre-seed completed badges from Excel if available
        if excel_badge_names and cnt_val > 0:
            badge_list = [b.strip() for b in str(excel_badge_names).split(',') if b.strip()]
            for b_name in badge_list:
                norm = normalize_title(b_name)
                # match against canonical target badges
                canonical = target_norm_map.get(norm, b_name)
                cursor.execute('''
                    INSERT OR IGNORE INTO participant_badges
                    (participant_id, badge_name, normalized_name, earned_date, scraped_at)
                    VALUES (?, ?, ?, ?, ?)
                ''', (p_id, canonical, norm, 'Recorded in Excel', now_str))

    conn.commit()
    conn.close()
    print(f"Successfully seeded {len(target_badges)} target badges and {seeded_count} participants into database!")

if __name__ == '__main__':
    seed_database(force_reload=True)
