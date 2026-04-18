from django.conf import settings
from django.core.mail import send_mail

try:
    send_mail(
        'OTP Mail Test',
        'OTP mail test body',
        settings.DEFAULT_FROM_EMAIL,
        [settings.OTP_GMAIL_USER],
        fail_silently=False,
    )
    print('MAIL_TEST=OK')
except Exception as e:
    print(f'MAIL_TEST=FAIL {type(e).__name__}: {e}')
