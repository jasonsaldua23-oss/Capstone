# Audit runner: isolate all database, file, email and network side effects.
import os, sys, socket, tempfile
from pathlib import Path
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'backend'))
os.environ['DOTENV_OVERRIDE'] = '0'
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_case_runner'
os.environ['ENABLE_CORE_DB_ROUTER'] = '0'
import django
django.setup()
from django.conf import settings
settings.DATABASE_ROUTERS = []
settings.SUPABASE_URL = ''
settings.SUPABASE_SERVICE_ROLE_KEY = ''
settings.WEB_PUSH_VAPID_PRIVATE_KEY = ''
settings.FCM_SERVICE_ACCOUNT_JSON = ''
settings.FCM_SERVICE_ACCOUNT_FILE = ''
def block_network(*args, **kwargs):
    raise OSError('AUDIT: outbound network disabled')
socket.socket.connect = block_network
socket.socket.connect_ex = block_network
from django.core.management import call_command
with tempfile.TemporaryDirectory(prefix='capstone-audit-') as media:
    settings.MEDIA_ROOT = Path(media)
    call_command('test', *(sys.argv[1:] or ['core']), verbosity=2, interactive=False)
