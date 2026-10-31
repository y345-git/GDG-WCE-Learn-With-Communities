import os
import io
from datetime import datetime
from flask import Flask, render_template, jsonify, request, send_file, Response
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

import database
import scraper
import data_loader

app = Flask(__name__)

# Ensure DB is seeded on app startup
data_loader.seed_database()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/stats')
def api_stats():
    stats = database.get_stats()
    sync_status = scraper.sync_manager.get_status()
    return jsonify({
        'status': 'success',
        'stats': stats,
        'sync_status': sync_status
    })

@app.route('/api/target-badges')
def api_target_badges():
    badges = database.get_all_target_badges()
    conn = database.get_db_connection()
    total_participants = conn.execute('SELECT COUNT(*) FROM participants').fetchone()[0]
    
    detailed = []
    for b in badges:
        cnt = conn.execute(
            'SELECT COUNT(*) FROM participant_badges WHERE normalized_name = ?',
            (b['normalized_name'],)
        ).fetchone()[0]
        detailed.append({
            'id': b['id'],
            'name': b['name'],
            'normalized_name': b['normalized_name'],
            'url': b['url'],
            'credits': b['credits_required'],
            'course_type': b['course_type'],
            'badge_order': b['badge_order'],
            'completed_count': cnt,
            'percentage': round((cnt / total_participants * 100) if total_participants else 0, 1)
        })
    conn.close()
    return jsonify({
        'status': 'success',
        'target_badges': detailed
    })

@app.route('/api/participants')
def api_participants():
    search = request.args.get('search', '').strip()
    milestone = request.args.get('milestone', '').strip()
    badge_filter = request.args.get('badge', '').strip()
    sort_by = request.args.get('sort_by', 'count_desc').strip()
    limit = request.args.get('limit', type=int)
    offset = request.args.get('offset', default=0, type=int)
    
    participants = database.get_participants(
        search=search,
        milestone=milestone,
        badge_filter=badge_filter,
        sort_by=sort_by,
        limit=limit,
        offset=offset
    )
    
    return jsonify({
        'status': 'success',
        'count': len(participants),
        'participants': participants
    })

@app.route('/api/participants/<int:participant_id>')
def api_participant_detail(participant_id):
    participant = database.get_participant_by_id(participant_id)
    if not participant:
        return jsonify({'status': 'error', 'message': 'Participant not found'}), 404
        
    target_badges = database.get_all_target_badges()
    completed_norm_set = {b['normalized_name']: b for b in participant.get('completed_badges', [])}
    
    # Map all 10 badges with completion status for this participant
    badge_checklist = []
    for tb in target_badges:
        norm = tb['normalized_name']
        is_completed = norm in completed_norm_set
        earned_info = completed_norm_set.get(norm, {})
        badge_checklist.append({
            'badge_order': tb['badge_order'],
            'name': tb['name'],
            'normalized_name': norm,
            'url': tb['url'],
            'credits': tb['credits_required'],
            'is_completed': is_completed,
            'earned_date': earned_info.get('earned_date', ''),
            'badge_image_url': earned_info.get('badge_image_url', ''),
            'badge_url': earned_info.get('badge_url', '')
        })
        
    participant['badge_checklist'] = badge_checklist
    return jsonify({
        'status': 'success',
        'participant': participant
    })

@app.route('/api/scrape/single/<int:participant_id>', methods=['POST'])
def api_scrape_single(participant_id):
    updated = scraper.scrape_single_participant(participant_id)
    if not updated or updated.get('success') is False:
        return jsonify({'status': 'error', 'message': updated.get('error', 'Scrape failed')}), 400
        
    # Also attach checklist
    target_badges = database.get_all_target_badges()
    completed_norm_set = {b['normalized_name']: b for b in updated.get('completed_badges', [])}
    badge_checklist = []
    for tb in target_badges:
        norm = tb['normalized_name']
        is_completed = norm in completed_norm_set
        earned_info = completed_norm_set.get(norm, {})
        badge_checklist.append({
            'badge_order': tb['badge_order'],
            'name': tb['name'],
            'normalized_name': norm,
            'url': tb['url'],
            'credits': tb['credits_required'],
            'is_completed': is_completed,
            'earned_date': earned_info.get('earned_date', ''),
            'badge_image_url': earned_info.get('badge_image_url', ''),
            'badge_url': earned_info.get('badge_url', '')
        })
    updated['badge_checklist'] = badge_checklist
    return jsonify({
        'status': 'success',
        'participant': updated
    })

@app.route('/api/scrape/start', methods=['POST'])
def api_scrape_start():
    data = request.get_json(silent=True) or {}
    mode = data.get('mode', 'all') # 'all', 'active' (completed_count > 0), or 'ids'
    
    participant_ids = None
    if mode == 'active':
        conn = database.get_db_connection()
        rows = conn.execute('SELECT id FROM participants WHERE completed_count > 0').fetchall()
        conn.close()
        participant_ids = [r['id'] for r in rows]
    elif mode == 'ids':
        participant_ids = data.get('ids', [])
        
    success, msg = scraper.sync_manager.start_sync(participant_ids=participant_ids, max_workers=10)
    return jsonify({
        'status': 'success' if success else 'error',
        'message': msg,
        'sync_status': scraper.sync_manager.get_status()
    })

@app.route('/api/scrape/stop', methods=['POST'])
def api_scrape_stop():
    success, msg = scraper.sync_manager.stop_sync()
    return jsonify({
        'status': 'success' if success else 'error',
        'message': msg,
        'sync_status': scraper.sync_manager.get_status()
    })

@app.route('/api/scrape/status')
def api_scrape_status():
    return jsonify({
        'status': 'success',
        'sync_status': scraper.sync_manager.get_status()
    })

@app.route('/api/export/excel')
def api_export_excel():
    conn = database.get_db_connection()
    participants = conn.execute('''
        SELECT p.*, GROUP_CONCAT(pb.badge_name, ', ') as completed_names
        FROM participants p
        LEFT JOIN participant_badges pb ON p.id = pb.participant_id
        GROUP BY p.id
        ORDER BY p.completed_count DESC, p.user_name ASC
    ''').fetchall()
    
    target_badges = conn.execute('SELECT * FROM target_badges ORDER BY badge_order ASC').fetchall()
    total_parts = len(participants)
    
    wb = openpyxl.Workbook()
    # Sheet 1: Participants Live Tracking
    ws1 = wb.active
    ws1.title = "Participants Live Tracking"
    
    headers = [
        "Participant ID",
        "User Name",
        "User Email",
        "Google Skills Profile URL",
        "Google Skills Profile Status",
        "Access Code",
        "Redemption Status",
        "Original Milestone",
        "Live Milestone Completed",
        "Live Target Badges Completed (Out of 10)",
        "Live Target Badges Names",
        "Total Profile Badges",
        "Last Scraped Timestamp",
        "Live Scrape Status"
    ]
    
    # Header styling
    header_fill = PatternFill(start_color="1A73E8", end_color="1A73E8", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    thin_border = Border(
        left=Side(style='thin', color='D0D7DE'),
        right=Side(style='thin', color='D0D7DE'),
        top=Side(style='thin', color='D0D7DE'),
        bottom=Side(style='thin', color='D0D7DE')
    )
    
    ws1.append(headers)
    for col_num in range(1, len(headers) + 1):
        cell = ws1.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        
    for p in participants:
        ws1.append([
            p['id'],
            p['user_name'],
            p['user_email'],
            p['profile_url'],
            p['profile_status'],
            p['access_code'],
            p['redemption_status'],
            p['milestone_original'],
            p['current_milestone'],
            p['completed_count'],
            p['completed_names'] or 'None',
            p['total_profile_badges'],
            p['last_scraped_at'] or 'Not Scraped Yet',
            p['scrape_status']
        ])
        
    # Auto-adjust column widths
    for col in ws1.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws1.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 45)
        
    # Sheet 2: Target Badges Breakdown
    ws2 = wb.create_sheet(title="Workshop 10 Badges Summary")
    b_headers = ["#", "Course / Badge Name", "Course URL", "Required Credits", "Completed Students Count", "Completion %"]
    ws2.append(b_headers)
    for col_num in range(1, len(b_headers) + 1):
        cell = ws2.cell(row=1, column=col_num)
        cell.fill = PatternFill(start_color="34A853", end_color="34A853", fill_type="solid")
        cell.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        
    for i, tb in enumerate(target_badges, 1):
        cnt = conn.execute(
            'SELECT COUNT(*) FROM participant_badges WHERE normalized_name = ?',
            (tb['normalized_name'],)
        ).fetchone()[0]
        pct = round((cnt / total_parts * 100) if total_parts else 0, 1)
        ws2.append([
            i,
            tb['name'],
            tb['url'],
            tb['credits_required'],
            cnt,
            f"{pct}%"
        ])
        
    for col in ws2.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws2.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 55)
        
    conn.close()
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"GDGC_Cloud_Workshop_Tracking_Live_{timestamp}.xlsx"
    return send_file(
        output,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename
    )

if __name__ == '__main__':
    import sys
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    port = int(os.environ.get('PORT', 5000))
    print(f"\n============================================================")
    print(f"GDG Cloud Workshop 10-Badge Live Tracking Webapp")
    print(f"Running at: http://localhost:{port}")
    print(f"============================================================\n")
    app.run(host='0.0.0.0', port=port, debug=False)
