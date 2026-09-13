# Audit probes use disposable records and real Django routing/authentication.
import os, sys, json, tempfile, socket, logging
from pathlib import Path
from unittest.mock import patch
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'backend'))
os.environ.update(DOTENV_OVERRIDE='0', DJANGO_SETTINGS_MODULE='config.settings_case_runner', ENABLE_CORE_DB_ROUTER='0')
import django
django.setup()
from django.conf import settings
settings.DATABASE_ROUTERS = []
settings.SUPABASE_URL = settings.SUPABASE_SERVICE_ROLE_KEY = ''
settings.WEB_PUSH_VAPID_PRIVATE_KEY = settings.FCM_SERVICE_ACCOUNT_JSON = settings.FCM_SERVICE_ACCOUNT_FILE = ''
settings.ALLOWED_HOSTS = ['testserver']
logging.disable(logging.CRITICAL)
def blocked(*args, **kwargs): raise OSError('AUDIT network disabled')
socket.socket.connect = blocked
from django.core.management import call_command
from django.test import Client
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from core import views_api as v
from core.auth import create_token, hash_password, decode_token
from core.models import User, Customer, RoleType, Warehouse, Product, Inventory, StockBatch, Order
call_command('migrate', run_syncdb=True, verbosity=0, interactive=False)
results = []
def record(name, **data):
    results.append(dict(probe=name, **data))
def client(token=None):
    return Client(raise_request_exception=False, enforce_csrf_checks=True, **({'HTTP_AUTHORIZATION':'Bearer '+token} if token else {}))
password = 'AuditOnly!482Aa'
users={}
tokens={}
for role,portal in [('SUPER_ADMIN','admin'),('ADMIN','admin'),('WAREHOUSE_STAFF','warehouse'),('DRIVER','driver')]:
    u=User.objects.create(email=role.lower()+'@audit.invalid',password=hash_password(password),name='Audit Person',role=role,login_alerts_enabled=False)
    users[role]=u
    response=client().post('/api/auth/login',data=json.dumps(dict(email=u.email,password=password,portal=portal,rememberMe=True)),content_type='application/json')
    tokens[role]=response.json().get('token')
    decoded=decode_token(tokens[role]) if tokens[role] else {}
    record('login_'+role,status=response.status_code,token_hours=(decoded.get('exp',0)-decoded.get('iat',0))/3600,cookie_httponly=all(c['httponly'] for c in response.cookies.values()))
customers=[Customer.objects.create(email=f'customer{i}@audit.invalid',password=hash_password(password),name='Audit Customer',login_alerts_enabled=False) for i in range(2)]
r=client().post('/api/auth/customer/login',data=json.dumps(dict(email=customers[0].email,password=password)),content_type='application/json')
tokens['CUSTOMER']=r.json().get('token');record('login_CUSTOMER',status=r.status_code)
driver=client(tokens['DRIVER']); customer=client(tokens['CUSTOMER']); admin=client(tokens['ADMIN'])
r=driver.put('/api/users/'+users['DRIVER'].id,data=json.dumps({'roleId':'SUPER_ADMIN'}),content_type='application/json')
users['DRIVER'].refresh_from_db();record('driver_self_promotes',status=r.status_code,persisted_role=users['DRIVER'].role)
r=driver.put('/api/users/'+users['ADMIN'].id,data=json.dumps({'twoFactorEnabled':False,'isActive':False}),content_type='application/json')
users['ADMIN'].refresh_from_db();record('driver_disables_admin',status=r.status_code,is_active=users['ADMIN'].is_active)
record('disabled_admin_token',auth_me=admin.get('/api/auth/me').status_code,users_api=admin.get('/api/users').status_code)
users['ADMIN'].is_active=True;users['ADMIN'].save()
r=customer.get('/api/customers');record('customer_lists_other_customers',status=r.status_code,other_customer_present=any(x['id']==customers[1].id for x in r.json().get('customers',[])),fields=list(r.json().get('customers',[{}])[0]))
r=customer.get('/api/customers/'+customers[1].id);record('customer_other_detail_guard',status=r.status_code)
r=driver.put('/api/customers/'+customers[1].id,data=json.dumps({'password':'ChangedAudit!482Aa'}),content_type='application/json')
customers[1].refresh_from_db();record('driver_resets_other_customer_password',status=r.status_code,changed=v.verify_password('ChangedAudit!482Aa',customers[1].password))
r=admin.post('/api/auth/logout');record('logout_replay',logout_status=r.status_code,replayed_status=client(tokens['ADMIN']).get('/api/users').status_code)
users['ADMIN'].role='DRIVER';users['ADMIN'].save();record('demoted_admin_token',status=admin.get('/api/users').status_code)
code=v._stateless_otp_for_bucket(customers[0].email,'customer','password_reset',v._otp_bucket(timezone.now()))
reset={'email':customers[0].email,'accountType':'customer','portal':'customer','otp':code,'newPassword':'ResetAudit!482Aa'}
first=client().post('/api/auth/password-reset/reset',data=json.dumps(reset),content_type='application/json')
reset['newPassword']='ResetAgainAudit!482Aa'
second=client().post('/api/auth/password-reset/reset',data=json.dumps(reset),content_type='application/json')
record('password_reset_otp_replay',first=first.status_code,second=second.status_code,old_session=customer.get('/api/auth/me').status_code)
for body in ['[]','null','42','"text"','{']:
    r=client().post('/api/auth/login',data=body,content_type='application/json');record('malformed_login_'+body,status=r.status_code)
with tempfile.TemporaryDirectory(prefix='audit-uploads-') as media:
    settings.MEDIA_ROOT=Path(media)
    # Route imports MEDIA_ROOT by value, so isolate its serving root as well.
    import config.urls
    with patch.object(config.urls,'MEDIA_ROOT',Path(media)):
        f=SimpleUploadedFile('audit.html',b'<html><body>audit inert payload</body></html>',content_type='image/png')
        r=customer.post('/api/uploads/customer-avatar',data={'file':f});url=r.json().get('imageUrl')
        fetched=client().get(url) if url else None
        record('spoofed_image_upload',status=r.status_code,url_extension=Path(url).suffix if url else None,anonymous_get=fetched.status_code if fetched else None,served_type=fetched.get('Content-Type') if fetched else None,cache=fetched.get('Cache-Control') if fetched else None)
        if fetched: fetched.close() # Close the streaming file before Windows temp cleanup.
        now=timezone.now()
        with patch('core.views_api.timezone.now',return_value=now):
            a=v._store_upload_bytes(b'first','pods','pod','.png','image/png')
            b=v._store_upload_bytes(b'second','pods','pod','.png','image/png')
        record('same_millisecond_upload_collision',same_url=a==b,first_content_overwritten=(Path(media)/a.lstrip('/')).read_bytes()==b'second')
        f=SimpleUploadedFile('large.png',b'x'*(6*1024*1024),content_type='image/png')
        r=customer.post('/api/uploads/customer-avatar',data={'file':f});record('invalid_6mb_image',status=r.status_code)
# No production secret values are written; this checks only fallback behavior.
with patch.dict(os.environ,{},clear=True):
    token=create_token({'type':'staff','role':'ADMIN','userId':users['ADMIN'].id})
    record('missing_jwt_secret_accepts_session',status=client(token).get('/api/users').status_code)
# Enumerate every route with GET and malformed unauthenticated write without real records/side effects.
for role, user in users.items():
    user.role=role; user.is_active=True; user.save()
# Only the external OTP delivery is mocked; challenge/session routing stays real.
users['ADMIN'].two_factor_enabled=True;users['ADMIN'].save()
with patch('core.views_api._otp_mail_ready',return_value=True), patch('core.views_api._send_login_otp_email'):
    challenge_response=client().post('/api/auth/login',data=json.dumps({'email':users['ADMIN'].email,'password':password,'portal':'admin'}),content_type='application/json')
challenge=challenge_response.json().get('challengeToken')
record('two_factor_challenge_as_session',login_status=challenge_response.status_code,customers_status=client(challenge).get('/api/customers').status_code,orders_status=client(challenge).get('/api/orders').status_code,auth_me_status=client(challenge).get('/api/auth/me').status_code)
# Exercise checkout with real product pricing and isolated inventory.
warehouse=Warehouse.objects.create(name='Audit Warehouse',code='AUDIT',address='Audit',city='Talisay',province='Negros Occidental',zip_code='6115')
product=Product.objects.create(name='Audit Water',sku='AUDIT-WATER',unit='case',price=120,is_active=True)
inventory=Inventory.objects.create(warehouse=warehouse,product=product,quantity=100,reserved_quantity=0,threshold=2)
StockBatch.objects.create(batch_number='AUDIT-BATCH',inventory=inventory,quantity=100,receipt_date=timezone.now(),status='ACTIVE')
body={'customerId':customers[1].id,'warehouseId':warehouse.id,'shippingLatitude':10.67,'shippingLongitude':122.95,'shippingCity':'Talisay','shippingProvince':'Negros Occidental','items':[{'productId':product.id,'quantity':2}]}
with patch('core.views_api._email_new_order_to_warehouse_staff'),patch('core.views_api._email_purchase_request_submitted_to_customer'):
    r=customer.post('/api/orders',data=json.dumps(body),content_type='application/json')
    record('shared_checkout_other_customer',status=r.status_code,other_owner=Order.objects.filter(customer=customers[1]).exists(),error=r.json().get('error'))
    body.update(tax=-1000,shippingCost=-200,paymentStatus='paid')
    r=customer.post('/api/customer/orders',data=json.dumps(body),content_type='application/json')
    oid=r.json().get('order',{}).get('id');order=Order.objects.filter(id=oid).first()
    record('checkout_client_financial_fields',status=r.status_code,total=order.total_amount if order else None,payment_status=order.payment_status if order else None,error=r.json().get('error'))
    body.pop('tax');body.pop('shippingCost');body.pop('paymentStatus')
    a=customer.post('/api/customer/orders',data=json.dumps(body),content_type='application/json')
    b=customer.post('/api/customer/orders',data=json.dumps(body),content_type='application/json')
    record('checkout_without_request_id_repeated',first=a.status_code,second=b.status_code,distinct_orders=a.json().get('order',{}).get('id')!=b.json().get('order',{}).get('id'))
record('deposit_refund_runtime',status=customer.post('/api/customer/orders/audit-missing/deposit-refund',data='{}',content_type='application/json').status_code)
User.objects.create(email=users['ADMIN'].email,password='audit-placeholder',name='Duplicate Audit',role='ADMIN')
record('duplicate_staff_database_constraint',same_email_role_count=User.objects.filter(email=users['ADMIN'].email,role='ADMIN').count())
# Verify tokens for registration proof cannot substitute for a full session.
email='audit.registration@gmail.com'
otp=v._stateless_otp_for_bucket(email,'customer','email_verification',v._otp_bucket(timezone.now()))
verified=client().post('/api/auth/email-verification/confirm',data=json.dumps({'email':email,'accountType':'customer','otp':otp}),content_type='application/json')
proof=verified.json().get('verificationToken')
record('email_proof_as_session',confirmation=verified.status_code,customers=client(proof).get('/api/customers').status_code)
registered=client().post('/api/auth/register',data=json.dumps({'name':'Audit Registration','email':email,'password':password,'emailVerificationToken':proof}),content_type='application/json')
record('verified_registration',status=registered.status_code,auth_me=client(registered.json().get('token')).get('/api/auth/me').status_code)
cors=client().options('/api/users',HTTP_ORIGIN='https://audit-untrusted.invalid',HTTP_ACCESS_CONTROL_REQUEST_METHOD='PUT')
record('untrusted_origin_cors',status=cors.status_code,reflected_origin=cors.get('Access-Control-Allow-Origin')=='https://audit-untrusted.invalid',credentials=cors.get('Access-Control-Allow-Credentials'))
cookie_client=client();cookie_client.cookies['auth_token_staff']=tokens['ADMIN']
r=cookie_client.put('/api/users/'+users['ADMIN'].id,data=json.dumps({'name':'Audit Cross Origin'}),content_type='text/plain',HTTP_ORIGIN='https://audit-untrusted.invalid')
record('cookie_mutation_no_csrf',status=r.status_code)
# Record configuration properties without disclosing any configured secret.
import ast
settings_ast=ast.parse((root/'backend/config/settings.py').read_text())
default_secret=next(node.value.args[1].value for node in settings_ast.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SECRET_KEY' for t in node.targets))
record('configuration_properties',django_secret_uses_source_default=settings.SECRET_KEY==default_secret,otp_uses_source_default=v._otp_secret()==default_secret,cors_allow_all=settings.CORS_ALLOW_ALL_ORIGINS,csrf_cookie_samesite=settings.CSRF_COOKIE_SAMESITE)
with patch('core.views_api._email_new_order_to_warehouse_staff'),patch('core.views_api._email_purchase_request_submitted_to_customer'):
    body['status']='DELIVERED'
    r=customer.post('/api/customer/orders',data=json.dumps(body),content_type='application/json')
    order=Order.objects.filter(id=r.json().get('order',{}).get('id')).first()
    record('checkout_delivered_without_approval',status=r.status_code,order_status=order.status if order else None,request_status=order.request_status if order else None)
    body.pop('status')
    for qty in [0,-1,1.5]:
        body['items'][0]['quantity']=qty
        r=customer.post('/api/customer/orders',data=json.dumps(body),content_type='application/json')
        record('checkout_quantity_'+str(qty),status=r.status_code,error=r.json().get('error'))
    body['items'][0]['quantity']=2
    body['requestId']='audit-unique-request'
    first=customer.post('/api/customer/orders',data=json.dumps(body),content_type='application/json')
    second=customer.post('/api/customer/orders',data=json.dumps(body),content_type='application/json')
    record('checkout_with_request_id',first=first.status_code,second=second.status_code,same_order=first.json().get('order',{}).get('id')==second.json().get('order',{}).get('id'))
record('expired_token_rejected',status=client(create_token({'type':'staff','role':'ADMIN','userId':users['ADMIN'].id},exp_hours=-1)).get('/api/users').status_code)
record('duplicate_customer_registration',status=client().post('/api/auth/register',data=json.dumps({'name':'Audit Registration','email':email,'password':password,'emailVerificationToken':proof}),content_type='application/json').status_code)
# Feedback validation is independent of order creation and must reject empty/out-of-range reviews.
for feedback_body in [{},{'rating':-1,'message':'Audit review'},{'rating':999,'message':'Audit review'}]:
    response=customer.post('/api/feedback',data=json.dumps(feedback_body),content_type='application/json')
    record('feedback_validation_'+str(feedback_body.get('rating','empty')),status=response.status_code,stored_rating=response.json().get('feedback',{}).get('rating'),stored_message=response.json().get('feedback',{}).get('message'))
from core.urls import urlpatterns
matrix=[]
import re
for pattern in urlpatterns:
    route='/api/'+re.sub(r'<str:[^>]+>','audit-missing',str(pattern.pattern))
    row={'route':route,'handler':pattern.callback.__name__}
    for role in ['ANONYMOUS','SUPER_ADMIN','ADMIN','WAREHOUSE_STAFF','DRIVER','CUSTOMER']:
        row[role]=client(tokens.get(role)).get(route).status_code
    row['anonymous_post_empty']=client().post(route,data='{}',content_type='application/json').status_code
    matrix.append(row)
# Per-write validation probes roll back even if an endpoint accepts an empty body.
from django.db import transaction
source_ast=ast.parse((root/'backend/core/views_api.py').read_text())
method_map={}
for node in source_ast.body:
    if isinstance(node,ast.FunctionDef):
        for decorator in node.decorator_list:
            if isinstance(decorator,ast.Call) and isinstance(decorator.func,ast.Name) and decorator.func.id=='require_http_methods':
                method_map[node.name]=ast.literal_eval(decorator.args[0])
validation=[]
for pattern in urlpatterns:
    route='/api/'+re.sub(r'<str:[^>]+>','audit-missing',str(pattern.pattern))
    for method in method_map.get(pattern.callback.__name__,[]):
        if method not in ['POST','PUT','PATCH']:continue
        for role in ['SUPER_ADMIN','WAREHOUSE_STAFF','DRIVER','CUSTOMER']:
            for payload in ['{}','[]']:
                with transaction.atomic():
                    response=getattr(client(tokens[role]),method.lower())(route,data=payload,content_type='application/json')
                    validation.append({'route':route,'method':method,'role':role,'body':payload,'status':response.status_code})
                    transaction.set_rollback(True)
(root/'test-reports/2026-09-13-prelaunch/validation-matrix.json').write_text(json.dumps(validation,indent=2))
(root/'test-reports/2026-09-13-prelaunch/probes.json').write_text(json.dumps(results,indent=2))
(root/'test-reports/2026-09-13-prelaunch/endpoint-matrix.json').write_text(json.dumps(matrix,indent=2))
print(json.dumps(results,indent=2))
print('Endpoint matrix rows:',len(matrix))
