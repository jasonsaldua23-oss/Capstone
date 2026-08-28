import cProfile, pstats, io, time
import os, django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import Client
from core.models import User
from core.auth import create_token
from core.views_api import _user_payload

d = User.objects.get(email='cadamonjohnniel@gmail.com')
t = create_token(_user_payload(d), 24)
c = Client()

pr = cProfile.Profile()
pr.enable()
start = time.time()
r = c.get('/api/driver/trips?page=1&pageSize=1000', HTTP_AUTHORIZATION=f'Bearer {t}')
print(f'Status: {r.status_code}, Time: {time.time()-start:.3f}s')
pr.disable()

s = io.StringIO()
ps = pstats.Stats(pr, stream=s).sort_stats('tottime')
ps.print_stats(30)
print(s.getvalue())
