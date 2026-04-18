from django.conf import settings
from django.core.mail import send_mail
from django.contrib.auth import get_user_model
from django.apps import apps

emails = ['driver@logistics.com', 'cadamonjohnniel@gmail.com']

print('EMAIL_HOST=', getattr(settings, 'EMAIL_HOST', None))
print('EMAIL_PORT=', getattr(settings, 'EMAIL_PORT', None))
print('EMAIL_USE_TLS=', bool(getattr(settings, 'EMAIL_USE_TLS', False)))

host_user = getattr(settings, 'EMAIL_HOST_USER', None)
host_pass = getattr(settings, 'EMAIL_HOST_PASSWORD', None)

print('EMAIL_HOST_USER_PRESENT=', bool(host_user))
print('EMAIL_HOST_PASSWORD_LEN=', len(host_pass) if host_pass else 0)

target = host_user if host_user else 'cadamonjohnniel@gmail.com'
print('TEST_RECIPIENT_SET=', bool(target))
print('MAIL_TEST=START')

try:
    n = send_mail(
        'SMTP test from Django',
        'SMTP test body',
        host_user if host_user else None,
        [target],
        fail_silently=False,
    )
    print('MAIL_TEST=SUCCESS sent_count=' + str(n))
except Exception as e:
    print('MAIL_TEST=FAIL')
    print('EXCEPTION_TYPE=' + type(e).__name__)
    print('EXCEPTION_MESSAGE=' + str(e))

User = get_user_model()
customer_model = None
for m in apps.get_models():
    if m.__name__.lower() == 'customer':
        customer_model = m
        break

for em in emails:
    try:
        u_exists = User.objects.filter(email__iexact=em).exists()
    except Exception:
        u_exists = False

    c_exists = None
    if customer_model is not None:
        fields = {f.name for f in customer_model._meta.get_fields()}
        if 'email' in fields:
            c_exists = customer_model.objects.filter(email__iexact=em).exists()
        elif 'user' in fields:
            c_exists = customer_model.objects.filter(user__email__iexact=em).exists()

    print(f'QUERY email={em} user_exists={u_exists} customer_exists={c_exists}')
