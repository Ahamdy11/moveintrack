import os
from pathlib import Path

TEST_DB = Path('/tmp/moveintrack-workflow-test.db')
if TEST_DB.exists(): TEST_DB.unlink()
os.environ.update({
    'ENVIRONMENT':'test',
    'DATABASE_URL':f'sqlite:///{TEST_DB}',
    'COOKIE_SECURE':'false',
    'ALLOWED_HOSTS':'testserver,localhost',
    'INITIAL_ADMIN_EMAIL':'admin@example.com',
    'INITIAL_ADMIN_PASSWORD':'AdminPass!2026',
})

from fastapi.testclient import TestClient
from app.main import app
from app.security import totp_code


def login(client, email, password):
    response = client.post('/api/auth/login', json={'email':email,'password':password})
    assert response.status_code == 200, response.text
    return response.json()['csrf_token']


def post(client, csrf, path, payload):
    return client.post(path, json=payload, headers={'X-CSRF-Token':csrf})


def put(client, csrf, path, payload):
    return client.put(path, json=payload, headers={'X-CSRF-Token':csrf})


def test_complete_workflow():
    with TestClient(app) as admin:
        csrf = login(admin, 'admin@example.com', 'AdminPass!2026')
        changed = post(admin, csrf, '/api/auth/change-password', {'current_password':'AdminPass!2026','new_password':'AdminPass!2027'})
        assert changed.status_code == 200, changed.text
        users = [
            ('creator@example.com','Journey Creator','creator'),
            ('approver@example.com','Operations Approver','approver'),
            ('hse@example.com','HSE Approver','hse'),
            ('control@example.com','Control Officer','control'),
        ]
        for email, name, role in users:
            r=post(admin,csrf,'/api/users',{'name':name,'email':email,'title':role,'division':'All Divisions','role':role,'password':'TempPass!2026','active':True,'must_change_password':False})
            assert r.status_code==200,r.text
        v=post(admin,csrf,'/api/vehicles',{'plate':'MIT-001','model':'Toyota Hilux','contractor':'Internal','vehicle_type':'Light','license_expiry':'2030-12-31','insurance_expiry':'2030-12-31','inspection_expiry':'2030-12-31','maintenance_due':'2030-12-31','gps_status':'Active','status':'active','notes':''})
        assert v.status_code==200,v.text
        vehicle_id=v.json()['id']
        d=post(admin,csrf,'/api/drivers',{'name':'Test Driver','phone':'01000000000','license_class':'Class 3 (Heavy)','license_expiry':'2030-12-31','ddc_expiry':'2030-12-31','medical_expiry':'2030-12-31','defensive_expiry':'2030-12-31','drug_test':'Clear','rest_hours':10,'status':'active','notes':''})
        assert d.status_code==200,d.text
        driver_id=d.json()['id']

        with TestClient(app) as creator:
            ccsrf=login(creator,'creator@example.com','TempPass!2026')
            boot=creator.get('/api/bootstrap').json()
            risk=[{'question_key':q['key'],'answer':False} for q in boot['risk_questions']]
            checks=[{'item_key':x['key'],'confirmed':True} for x in boot['checklist_items']]
            payload={'division':'Logistics','site':'HQ','purpose':'Test controlled journey','start_location':'HQ','end_location':'Warehouse','departure_at':'2029-01-10T08:00:00','estimated_arrival_at':'2029-01-10T10:00:00','distance_km':80,'night_drive':False,'load_type':'Passengers','passengers':'Tester','vehicle_id':vehicle_id,'driver_id':driver_id,'risk_answers':risk,'checklist_answers':checks,'submit':True}
            created=post(creator,ccsrf,'/api/journeys',payload)
            assert created.status_code==200,created.text
            journey=created.json(); assert journey['status']=='pending_approval'; assert journey['risk_level']=='low'
            journey_id=journey['id']

        with TestClient(app) as approver:
            acsrf=login(approver,'approver@example.com','TempPass!2026')
            queue=approver.get('/api/approvals').json()['items']
            assert any(j['id']==journey_id for j in queue)
            approved=post(approver,acsrf,f'/api/journeys/{journey_id}/approve',{'comment':'Approved for execution'})
            assert approved.status_code==200,approved.text
            assert approved.json()['status']=='approved'

        with TestClient(app) as control:
            xcsrf=login(control,'control@example.com','TempPass!2026')
            for status in ['departed']:
                r=post(control,xcsrf,f'/api/journeys/{journey_id}/transition',{'status':status,'comment':'Control action'})
                assert r.status_code==200,r.text
            r=post(control,xcsrf,f'/api/journeys/{journey_id}/checkin',{'comment':'Driver safe','location':'Checkpoint A'})
            assert r.status_code==200,r.text
            for status in ['arrived','closed']:
                r=post(control,xcsrf,f'/api/journeys/{journey_id}/transition',{'status':status,'comment':'Control action'})
                assert r.status_code==200,r.text
            assert r.json()['status']=='closed'

        # High-risk journey requires Approver then HSE.
        with TestClient(app) as creator:
            ccsrf=login(creator,'creator@example.com','TempPass!2026')
            boot=creator.get('/api/bootstrap').json()
            risk=[{'question_key':q['key'],'answer':q['key'] in {'remote_area','poor_road','adverse_weather','no_second_driver'}} for q in boot['risk_questions']]
            checks=[{'item_key':x['key'],'confirmed':True} for x in boot['checklist_items']]
            payload={'division':'Logistics','site':'HQ','purpose':'High-risk night dangerous-goods journey','start_location':'HQ','end_location':'Remote Site','departure_at':'2029-01-11T22:00:00','estimated_arrival_at':'2029-01-12T05:00:00','distance_km':420,'night_drive':True,'load_type':'Dangerous Goods','passengers':'Two operators','vehicle_id':vehicle_id,'driver_id':driver_id,'risk_answers':risk,'checklist_answers':checks,'submit':True}
            high=post(creator,ccsrf,'/api/journeys',payload)
            assert high.status_code==200,high.text
            high_journey=high.json(); assert high_journey['risk_level']=='high'; assert high_journey['status']=='pending_approval'
            high_id=high_journey['id']

        with TestClient(app) as approver:
            acsrf=login(approver,'approver@example.com','TempPass!2026')
            first=post(approver,acsrf,f'/api/journeys/{high_id}/approve',{'comment':'Operational approval'})
            assert first.status_code==200,first.text
            assert first.json()['status']=='pending_approval'
            assert any(a['required_role']=='hse' and a['status']=='pending' for a in first.json()['approvals'])

        with TestClient(app) as hse:
            hcsrf=login(hse,'hse@example.com','TempPass!2026')
            second=post(hse,hcsrf,f'/api/journeys/{high_id}/approve',{'comment':'HSE controls accepted'})
            assert second.status_code==200,second.text
            assert second.json()['status']=='approved'

        audit=admin.get('/api/audit').json()['items']
        assert any(x['action']=='journey.transition' for x in audit)
        assert sum(1 for x in audit if x['action']=='journey.approve') >= 3
        readiness=admin.get('/api/readiness')
        assert readiness.status_code==200

        setup=post(admin,csrf,'/api/auth/mfa/setup',{})
        assert setup.status_code==200,setup.text
        secret=setup.json()['secret']
        confirmed=post(admin,csrf,'/api/auth/mfa/confirm',{'code':totp_code(secret)})
        assert confirmed.status_code==200,confirmed.text
        assert len(confirmed.json()['recovery_codes'])==10

        with TestClient(app) as mfa_client:
            first=mfa_client.post('/api/auth/login',json={'email':'admin@example.com','password':'AdminPass!2027'})
            assert first.status_code==202,first.text
            second=mfa_client.post('/api/auth/login',json={'email':'admin@example.com','password':'AdminPass!2027','otp':totp_code(secret)})
            assert second.status_code==200,second.text
