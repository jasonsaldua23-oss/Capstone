import os, django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.conf import settings
settings.DEBUG = True

from core.models import User
from core.auth import create_token
from core.views_api import _user_payload
from django.test import Client
from django.db import connection

d = User.objects.get(email='cadamonjohnniel@gmail.com')
t = create_token(_user_payload(d), 24)
c = Client()

r = c.get('/api/driver/trips?page=1&pageSize=1000', HTTP_AUTHORIZATION=f'Bearer {t}')

for i, q in enumerate(connection.queries):
    print(f"Query {i+1}: {q['time']}s -> {q['sql'][:150]}...")
print(f"Total queries: {len(connection.queries)}")
