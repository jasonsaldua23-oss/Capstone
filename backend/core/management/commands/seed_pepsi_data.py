# -*- coding: utf-8 -*-
"""
Django Management Command: seed_pepsi_data
Seeds the LMS_CFM system using real operational data from Pepsi-Sales.xlsx (excluding empties).
"""
import os
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal
from datetime import datetime, timedelta, date
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.contrib.auth.hashers import make_password

from core.models import (
    User, Customer, Warehouse, PackagingProfile, Product,
    Inventory, StockBatch, InventoryTransaction,
    Order, OrderItem, OrderTimeline,
    Vehicle, Trip, TripDropPoint, LocationLog,
    Replacement, ReplacementLine, Feedback, Notification
)


# Standard Product Catalog Mapping for the 37 Columns in Pepsi-Sales.xlsx
PRODUCT_DEFS = {
    'B': {
        'name': 'Mountain Dew 12oz',
        'sku': 'MOUN-CAS-12OZ-RGB24',
        'category': 'Carbonated (Glass)',
        'size': '12oz',
        'unit': 'case',
        'case_price': Decimal('265.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/mountain-dew-12oz.png'
    },
    'C': {
        'name': 'Mountain Dew 1L Litro',
        'sku': 'MOUN-CAS-1LIT-RGB12',
        'category': 'Carbonated (Glass)',
        'size': '1L',
        'unit': 'case',
        'case_price': Decimal('285.00'),
        'units_per_case': 12,
        'is_returnable': True,
        'image': '/images/products/mountain-dew-1l.png'
    },
    'D': {
        'name': 'Pepsi 1L Litro',
        'sku': 'PEPS-CAS-1LIT-RGB12',
        'category': 'Carbonated (Glass)',
        'size': '1L',
        'unit': 'case',
        'case_price': Decimal('280.00'),
        'units_per_case': 12,
        'is_returnable': True,
        'image': '/images/products/pepsi-1l.png'
    },
    'E': {
        'name': 'Mountain Dew Mega 1L',
        'sku': 'MOUN-CAS-MEGA1L-RGB12',
        'category': 'Carbonated (Glass)',
        'size': '1L',
        'unit': 'case',
        'case_price': Decimal('290.00'),
        'units_per_case': 12,
        'is_returnable': True,
        'image': '/images/products/mountain-dew-mega.png'
    },
    'F': {
        'name': '7Up 1L Litro',
        'sku': '7UPP-CAS-1LIT-RGB12',
        'category': 'Carbonated (Glass)',
        'size': '1L',
        'unit': 'case',
        'case_price': Decimal('280.00'),
        'units_per_case': 12,
        'is_returnable': True,
        'image': '/images/products/7up-1l.png'
    },
    'G': {
        'name': 'Pepsi 8oz Glass',
        'sku': 'PEPS-CAS-8OZ-RGB24',
        'category': 'Carbonated (Glass)',
        'size': '8oz',
        'unit': 'case',
        'case_price': Decimal('240.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/pepsi-8oz.png'
    },
    'H': {
        'name': 'Mountain Dew 8oz Glass',
        'sku': 'MOUN-CAS-8OZ-RGB24',
        'category': 'Carbonated (Glass)',
        'size': '8oz',
        'unit': 'case',
        'case_price': Decimal('245.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/mountain-dew-8oz.png'
    },
    'I': {
        'name': '7Up 8oz Glass',
        'sku': '7UPP-CAS-8OZ-RGB24',
        'category': 'Carbonated (Glass)',
        'size': '8oz',
        'unit': 'case',
        'case_price': Decimal('240.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/7up-8oz.png'
    },
    'J': {
        'name': 'Sting Energy Drink 240ml Glass',
        'sku': 'STIN-CAS-240M-RGB24',
        'category': 'Energy Drink',
        'size': '240ml',
        'unit': 'case',
        'case_price': Decimal('360.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/sting-glass.png'
    },
    'K': {
        'name': 'Tropicana Twister 240ml Glass',
        'sku': 'TROP-CAS-240M-RGB24',
        'category': 'Juice',
        'size': '240ml',
        'unit': 'case',
        'case_price': Decimal('340.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/tropicana-glass.png'
    },
    'L': {
        'name': 'Gatorade 8oz Glass',
        'sku': 'GATO-CAS-8OZ-RGB24',
        'category': 'Isotonic / Sports',
        'size': '8oz',
        'unit': 'case',
        'case_price': Decimal('420.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/gatorade-glass.png'
    },
    'M': {
        'name': 'Neon Energy 250ml Can',
        'sku': 'NEON-CAS-250M-CAN24',
        'category': 'Energy Drink',
        'size': '250ml',
        'unit': 'case',
        'case_price': Decimal('480.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/neon-can.png'
    },
    'N': {
        'name': 'Panalo Cola 12oz Glass',
        'sku': 'PANA-CAS-12OZ-RGB24',
        'category': 'Carbonated (Glass)',
        'size': '12oz',
        'unit': 'case',
        'case_price': Decimal('210.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/panalo-12oz.png'
    },
    'O': {
        'name': 'Sting Power Pac Strawberry 300ml PET',
        'sku': 'STIN-CAS-300M-PET24',
        'category': 'Energy Drink',
        'size': '300ml',
        'unit': 'case',
        'case_price': Decimal('380.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/sting-pet.png'
    },
    'P': {
        'name': 'Gatorade No Sugar 350ml PET',
        'sku': 'GATO-CAS-350M-NS24',
        'category': 'Isotonic / Sports',
        'size': '350ml',
        'unit': 'case',
        'case_price': Decimal('560.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/gatorade-ns.png'
    },
    'Q': {
        'name': 'Gatorade 350ml 6-Pack',
        'sku': 'GATO-PCK-350M-PET06',
        'category': 'Isotonic / Sports',
        'size': '350ml',
        'unit': 'pack',
        'case_price': Decimal('145.00'),
        'units_per_case': 6,
        'is_returnable': False,
        'image': '/images/products/gatorade-6pack.png'
    },
    'R': {
        'name': 'Gatorade 350ml 24-Case',
        'sku': 'GATO-CAS-350M-PET24',
        'category': 'Isotonic / Sports',
        'size': '350ml',
        'unit': 'case',
        'case_price': Decimal('580.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/gatorade-350ml.png'
    },
    'S': {
        'name': 'Gatorade Blue Bolt 350ml',
        'sku': 'GATO-CAS-350M-BLU24',
        'category': 'Isotonic / Sports',
        'size': '350ml',
        'unit': 'case',
        'case_price': Decimal('580.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/gatorade-blue.png'
    },
    'T': {
        'name': 'Gatorade 500ml PET',
        'sku': 'GATO-CAS-500M-PET24',
        'category': 'Isotonic / Sports',
        'size': '500ml',
        'unit': 'case',
        'case_price': Decimal('720.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/gatorade-500ml.png'
    },
    'U': {
        'name': 'Tropicana Twister Orange 355ml PET',
        'sku': 'TROP-CAS-355M-PET24',
        'category': 'Juice',
        'size': '355ml',
        'unit': 'case',
        'case_price': Decimal('420.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/tropicana-orange.png'
    },
    'V': {
        'name': 'Pepsi 1.5L PET',
        'sku': 'PEPS-CAS-1500-PET12',
        'category': 'Carbonated (PET/PLASTIC)',
        'size': '1.5L',
        'unit': 'case',
        'case_price': Decimal('540.00'),
        'units_per_case': 12,
        'is_returnable': False,
        'image': '/images/products/pepsi-1.5l.png'
    },
    'W': {
        'name': 'Pepsi 2L PET',
        'sku': 'PEPS-CAS-2000-PET06',
        'category': 'Carbonated (PET/PLASTIC)',
        'size': '2L',
        'unit': 'case',
        'case_price': Decimal('390.00'),
        'units_per_case': 6,
        'is_returnable': False,
        'image': '/images/products/pepsi-2l.png'
    },
    'X': {
        'name': 'Mountain Dew 1L PET',
        'sku': 'MOUN-CAS-1000-PET12',
        'category': 'Carbonated (PET/PLASTIC)',
        'size': '1L',
        'unit': 'case',
        'case_price': Decimal('480.00'),
        'units_per_case': 12,
        'is_returnable': False,
        'image': '/images/products/mountain-dew-1l-pet.png'
    },
    'Y': {
        'name': 'Pepsi 330ml Aluminum Cans',
        'sku': 'PEPS-CAS-330M-CAN24',
        'category': 'Carbonated (Can)',
        'size': '330ml',
        'unit': 'case',
        'case_price': Decimal('650.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/pepsi-can.png'
    },
    'Z': {
        'name': 'Sulit Cola 200ml',
        'sku': 'SULI-CAS-200M-PET24',
        'category': 'Carbonated (PET/PLASTIC)',
        'size': '200ml',
        'unit': 'case',
        'case_price': Decimal('220.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/sulit-200ml.png'
    },
    'AA': {
        'name': 'Premier Purified Water 350ml',
        'sku': 'PREM-CAS-350M-PET24',
        'category': 'Water',
        'size': '350ml',
        'unit': 'case',
        'case_price': Decimal('190.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/premier-350ml.png'
    },
    'AB': {
        'name': 'Premier Purified Water 500ml',
        'sku': 'PREM-CAS-500M-PET24',
        'category': 'Water',
        'size': '500ml',
        'unit': 'case',
        'case_price': Decimal('230.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/premier-500ml.png'
    },
    'AC': {
        'name': 'Premier Purified Water 1L',
        'sku': 'PREM-CAS-1000-PET12',
        'category': 'Water',
        'size': '1L',
        'unit': 'case',
        'case_price': Decimal('210.00'),
        'units_per_case': 12,
        'is_returnable': False,
        'image': '/images/products/premier-1l.png'
    },
    'AD': {
        'name': 'Tropicana Apple 240ml Glass',
        'sku': 'TROP-CAS-240M-APL24',
        'category': 'Juice',
        'size': '240ml',
        'unit': 'case',
        'case_price': Decimal('340.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/tropicana-apple.png'
    },
    'AE': {
        'name': 'Hard Energy Drink 250ml Can',
        'sku': 'HARD-CAS-250M-CAN24',
        'category': 'Energy Drink',
        'size': '250ml',
        'unit': 'case',
        'case_price': Decimal('460.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/hard-energy.png'
    },
    'AF': {
        'name': 'Chum Churum Soju 360ml',
        'sku': 'CHUM-CAS-360M-GLS20',
        'category': 'Alcoholic',
        'size': '360ml',
        'unit': 'case',
        'case_price': Decimal('1350.00'),
        'units_per_case': 20,
        'is_returnable': False,
        'image': '/images/products/chum-churum.png'
    },
    'AG': {
        'name': 'Milkis Carbonated Milk Drink 250ml',
        'sku': 'MILK-CAS-250M-CAN24',
        'category': 'Specialty / Milk',
        'size': '250ml',
        'unit': 'case',
        'case_price': Decimal('720.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/milkis-can.png'
    },
    'AH': {
        'name': 'Milkis 330ml Cans',
        'sku': 'MILK-CAS-330M-CAN24',
        'category': 'Specialty / Milk',
        'size': '330ml',
        'unit': 'case',
        'case_price': Decimal('840.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/milkis-330ml.png'
    },
    'AI': {
        'name': 'Gatorade 237ml Glass',
        'sku': 'GATO-CAS-237M-RGB24',
        'category': 'Isotonic / Sports',
        'size': '237ml',
        'unit': 'case',
        'case_price': Decimal('390.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/gatorade-237ml.png'
    },
    'AJ': {
        'name': 'Gatorade Fierce 900ml PET',
        'sku': 'GATO-CAS-900M-PET12',
        'category': 'Isotonic / Sports',
        'size': '900ml',
        'unit': 'case',
        'case_price': Decimal('680.00'),
        'units_per_case': 12,
        'is_returnable': False,
        'image': '/images/products/gatorade-900ml.png'
    },
    'AK': {
        'name': 'Lipton Red Tea 240ml Glass',
        'sku': 'LIPT-CAS-240M-RED24',
        'category': 'Tea',
        'size': '240ml',
        'unit': 'case',
        'case_price': Decimal('320.00'),
        'units_per_case': 24,
        'is_returnable': True,
        'image': '/images/products/lipton-red.png'
    },
    'AL': {
        'name': 'Lipton Lemon Tea 290ml PET',
        'sku': 'LIPT-CAS-290M-PET24',
        'category': 'Tea',
        'size': '290ml',
        'unit': 'case',
        'case_price': Decimal('360.00'),
        'units_per_case': 24,
        'is_returnable': False,
        'image': '/images/products/lipton-lemon.png'
    }
}

# Negros Occidental Real Locations for Outlets
LOCATIONS_POOL = [
    {"address": "Lacson Street, Mandalagan", "city": "Bacolod City", "lat": 10.6892, "lng": 122.9612},
    {"address": "Bredco Port Area, Reclamation", "city": "Bacolod City", "lat": 10.6720, "lng": 122.9385},
    {"address": "Burgos Avenue, Barangay Villamonte", "city": "Bacolod City", "lat": 10.6715, "lng": 122.9680},
    {"address": "Araneta Street, Singcang-Airport", "city": "Bacolod City", "lat": 10.6432, "lng": 122.9410},
    {"address": "Libertad Market Complex", "city": "Bacolod City", "lat": 10.6610, "lng": 122.9490},
    {"address": "Mabini Street, Zone 1", "city": "Talisay City", "lat": 10.7320, "lng": 122.9685},
    {"address": "Fisheries Avenue, Zone 2", "city": "Talisay City", "lat": 10.7380, "lng": 122.9610},
    {"address": "Capitan Sabi Street, Zone 12A", "city": "Talisay City", "lat": 10.7410, "lng": 122.9730},
    {"address": "Rizal Street, Silay Heritage Zone", "city": "Silay City", "lat": 10.7980, "lng": 122.9750},
    {"address": "Barangay Guinhalaran", "city": "Silay City", "lat": 10.7810, "lng": 122.9680},
    {"address": "Barangay Bata Commercial Center", "city": "Bacolod City", "lat": 10.7050, "lng": 122.9620},
    {"address": "Lopez Jaena Street, Shopping Area", "city": "Bacolod City", "lat": 10.6770, "lng": 122.9590},
    {"address": "Mansilingan Central Highway", "city": "Bacolod City", "lat": 10.6380, "lng": 122.9850},
    {"address": "Sum-ag Main Highway", "city": "Bacolod City", "lat": 10.6120, "lng": 122.9350},
    {"address": "Taculing Road, Taculing", "city": "Bacolod City", "lat": 10.6550, "lng": 122.9620},
    {"address": "Banago Coastal Road", "city": "Bacolod City", "lat": 10.6980, "lng": 122.9420},
    {"address": "Alunan Avenue, Zone 4", "city": "Talisay City", "lat": 10.7350, "lng": 122.9710},
    {"address": "Barangay Dos Hermanas", "city": "Talisay City", "lat": 10.7210, "lng": 123.0120},
    {"address": "Barangay Matab-ang", "city": "Talisay City", "lat": 10.7450, "lng": 122.9850},
    {"address": "Poblacion Market, Manapla", "city": "Manapla", "lat": 10.9560, "lng": 123.1180}
]


class Command(BaseCommand):
    help = 'Seeds LMS_CFM system using real Pepsi-Sales.xlsx data (excluding empties)'

    def add_arguments(self, parser):
        parser.add_argument('--file', type=str, default='../Pepsi-Sales.xlsx', help='Path to Pepsi-Sales.xlsx')
        parser.add_argument('--outlets', type=int, default=30, help='Number of customer store outlets to import')
        parser.add_argument('--orders-limit', type=int, default=50, help='Number of historical orders to seed')
        parser.add_argument('--clear', action='store_true', help='Clear existing demo data before seeding')

    def handle(self, *args, **options):
        file_path = options['file']
        if not os.path.exists(file_path):
            # Check in parent or current dir
            alt_path = 'Pepsi-Sales.xlsx'
            if os.path.exists(alt_path):
                file_path = alt_path
            else:
                self.stderr.write(self.style.ERROR(f"File not found: {file_path}"))
                return

        self.stdout.write(self.style.SUCCESS(f"Reading {file_path} for Pepsi distribution seed data (WITHOUT EMPTIES)..."))

        # Parse Excel using zipfile + xml
        parsed_outlets, parsed_orders = self.parse_excel(file_path)
        self.stdout.write(f"Parsed {len(parsed_outlets)} unique store outlets and {len(parsed_orders)} order transactions from Excel.")

        outlets_count = options['outlets']
        orders_limit = options['orders_limit']
        do_clear = options['clear']

        # Precompute password hash once for instant user creation
        client_pass_hash = make_password('ClientPass123!')
        driver_pass_hash = make_password('DriverPass123!')

        with transaction.atomic():
            if do_clear:
                self.clear_existing_demo_data()

            warehouse = self.seed_warehouse()
            drivers, vehicles = self.seed_fleet(driver_pass_hash)
            products_map = self.seed_products()
            self.seed_inventory(warehouse, products_map)
            customers_map = self.seed_customers(parsed_outlets, outlets_count, client_pass_hash)
            orders = self.seed_orders(parsed_orders, customers_map, products_map, orders_limit)
            trips = self.seed_trips(warehouse, drivers, vehicles, orders)
            self.seed_feedback_and_replacements(customers_map, orders)

        self.stdout.write(self.style.SUCCESS(
            f"\n[SUCCESS] Seeded LMS_CFM with authentic Pepsi distribution data!\n"
            f" - Warehouse: {warehouse.name} ({warehouse.code})\n"
            f" - Products: {len(products_map)} PepsiCo SKUs\n"
            f" - Customers / Outlets: {len(customers_map)} stores\n"
            f" - Orders: {len(orders)} sales orders\n"
            f" - Trips: {len(trips)} delivery routes\n"
            f" - Empties / Bottle Returns: EXCLUDED as requested.\n"
        ))

    def parse_excel(self, file_path):
        """Parses Pepsi-Sales.xlsx using standard library zipfile and ultra-fast streaming iterparse."""
        z = zipfile.ZipFile(file_path)
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            sst_tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in sst_tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                t_nodes = si.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                shared_strings.append(''.join([t.text for t in t_nodes if t.text]))

        def get_col(ref):
            return ''.join([c for c in ref if c.isalpha()])

        sheet_xml = z.open('xl/worksheets/sheet1.xml')
        context = ET.iterparse(sheet_xml, events=('start', 'end'))

        outlet_frequency = {}
        parsed_orders = []
        current_row = None
        row_cells = {}

        for event, elem in context:
            tag = elem.tag.split('}')[-1]
            if event == 'start':
                if tag == 'row':
                    current_row = elem.attrib.get('r')
                    row_cells = {}
            elif event == 'end':
                if tag == 'c':
                    ref = elem.attrib.get('r')
                    if ref:
                        col = get_col(ref)
                        t = elem.attrib.get('t')
                        v_elem = elem.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                        val = v_elem.text if v_elem is not None else None
                        if t == 's' and val is not None:
                            val = shared_strings[int(val)]
                        row_cells[col] = val
                    elem.clear()
                elif tag == 'row':
                    outlet = row_cells.get('A')
                    if outlet:
                        outlet_clean = outlet.strip()
                        if not any(k in outlet_clean.lower() for k in ['total', 'balance', 'load in', 'load out', 'product/outlet', 'empties']):
                            items = {}
                            for col, val in row_cells.items():
                                if col in PRODUCT_DEFS and val:
                                    try:
                                        qty = float(val)
                                        if qty != 0:
                                            items[col] = abs(int(qty))
                                    except:
                                        pass
                            if items:
                                outlet_frequency[outlet_clean] = outlet_frequency.get(outlet_clean, 0) + 1
                                parsed_orders.append({
                                    'row': current_row,
                                    'outlet': outlet_clean,
                                    'items': items
                                })
                    elem.clear()
                    if len(parsed_orders) >= 500:
                        break

        sorted_outlets = sorted(outlet_frequency.keys(), key=lambda x: outlet_frequency[x], reverse=True)
        return sorted_outlets, parsed_orders

    def clear_existing_demo_data(self):
        self.stdout.write("Clearing existing demo orders, trips, and demo products...")
        Feedback.objects.all().delete()
        ReplacementLine.objects.all().delete()
        Replacement.objects.all().delete()
        TripDropPoint.objects.all().delete()
        Trip.objects.all().delete()
        OrderItem.objects.all().delete()
        OrderTimeline.objects.all().delete()
        Order.objects.all().delete()
        InventoryTransaction.objects.all().delete()
        StockBatch.objects.all().delete()
        Inventory.objects.all().delete()

    def seed_warehouse(self):
        self.stdout.write("Seeding Warehouse...")
        wh = Warehouse.objects.first()
        if not wh:
            wh = Warehouse.objects.create(
                name="Ann Ann's Central Warehouse",
                code="001",
                address="Bredco Port Area, Reclamation Area",
                city="Bacolod City",
                province="Negros Occidental",
                zip_code="6100",
                country="Philippines",
                latitude=10.6720,
                longitude=122.9385,
                capacity=25000
            )
        else:
            wh.capacity = 25000
            wh.save()
        return wh

    def seed_fleet(self, driver_pass_hash):
        self.stdout.write("Seeding Fleet Drivers & Vehicles...")
        # Create Drivers
        drivers = []
        driver_configs = [
            {'email': 'driver.juan@lms.local', 'name': 'Juan Perez', 'phone': '09181234567', 'license': 'N02-18-123456'},
            {'email': 'driver.carlos@lms.local', 'name': 'Carlos Mendoza', 'phone': '09199876543', 'license': 'N02-19-987654'},
            {'email': 'driver.mark@lms.local', 'name': 'Mark Gomez', 'phone': '09205554321', 'license': 'N02-20-456789'}
        ]
        for dc in driver_configs:
            u, _ = User.objects.get_or_create(
                email=dc['email'],
                defaults={
                    'name': dc['name'],
                    'first_name': dc['name'].split()[0],
                    'last_name': dc['name'].split()[-1],
                    'phone': dc['phone'],
                    'role': 'driver',
                    'license_number': dc['license'],
                    'password': driver_pass_hash
                }
            )
            drivers.append(u)

        # Create Vehicles
        vehicles = []
        vehicle_configs = [
            {'plate': 'ABC-1234', 'brand': 'Isuzu', 'model': 'NPR Reefer Chiller', 'capacity': 450, 'driver': drivers[0]},
            {'plate': 'NCB-5678', 'brand': 'Mitsubishi', 'model': 'Canter Chilled Van', 'capacity': 350, 'driver': drivers[1]},
            {'plate': 'XYZ-9012', 'brand': 'Hino', 'model': '300 Series Beverage Reefer', 'capacity': 500, 'driver': drivers[2]}
        ]
        for vc in vehicle_configs:
            v, _ = Vehicle.objects.get_or_create(
                license_plate=vc['plate'],
                defaults={
                    'brand': vc['brand'],
                    'model': vc['model'],
                    'year': 2024,
                    'type': 'REFRIGERATED_TRUCK',
                    'classification': 'HEAVY',
                    'capacity': vc['capacity'],
                    'status': 'AVAILABLE',
                    'driver': vc['driver'],
                    'is_active': True
                }
            )
            vehicles.append(v)

        return drivers, vehicles

    def seed_products(self):
        self.stdout.write("Seeding 37 PepsiCo Products & Packaging Profiles...")
        products_map = {}

        for col, pdef in PRODUCT_DEFS.items():
            # Packaging profile
            pkg_code = f"PKG-{pdef['sku']}"
            pkg, _ = PackagingProfile.objects.get_or_create(
                code=pkg_code,
                defaults={
                    'name': f"{pdef['name']} Packaging",
                    'container_type': 'BOTTLE' if 'Glass' in pdef['category'] or 'PET' in pdef['category'] else 'CAN',
                    'container_size': pdef['size'],
                    'standard_units_per_case': pdef['units_per_case'],
                    'base_unit_label': 'bottle' if 'Can' not in pdef['category'] else 'can',
                    'compatibility_key': f"COMPAT-{pdef['size'].upper()}",
                    'is_returnable': pdef['is_returnable'],
                    'default_deposit_amount': Decimal('0.00'),  # Empties excluded
                    'is_active': True
                }
            )

            # Product
            prod, _ = Product.objects.get_or_create(
                sku=pdef['sku'],
                defaults={
                    'name': pdef['name'],
                    'category': pdef['category'],
                    'unit': pdef['unit'],
                    'price': pdef['case_price'],
                    'case_price': pdef['case_price'],
                    'retail_unit_price': (pdef['case_price'] / pdef['units_per_case']).quantize(Decimal('0.01')),
                    'quantity_per_unit': pdef['units_per_case'],
                    'sizes': pdef['size'],
                    'image_url': pdef['image']
                }
            )
            products_map[col] = prod

        return products_map

    def seed_inventory(self, warehouse, products_map):
        self.stdout.write("Seeding Starting Warehouse Inventory & Stock Batches...")
        now = timezone.now()

        for col, prod in products_map.items():
            inv, _ = Inventory.objects.get_or_create(
                warehouse=warehouse,
                product=prod,
                defaults={
                    'quantity': 350,  # 350 cases on hand
                    'loose_bottles': 0,
                    'reserved_quantity': 0,
                    'threshold': 50
                }
            )

            # Unique Stock batch number per product and column
            batch_num = f"BATCH-PEP-{col}-{prod.sku}-{now.strftime('%Y%m%d')}"
            StockBatch.objects.get_or_create(
                batch_number=batch_num,
                defaults={
                    'inventory': inv,
                    'quantity': 350,
                    'loose_units': 0,
                    'receipt_date': now - timedelta(days=5),
                    'expiry_date': now + timedelta(days=365),
                    'location_label': f"Bay-Cold-{col}",
                    'status': 'ACTIVE'
                }
            )

            # Record Stock-in transaction
            InventoryTransaction.objects.get_or_create(
                warehouse=warehouse,
                product=prod,
                type='STOCK_IN',
                quantity=350,
                defaults={
                    'quantity_unit': 'case',
                    'stock_unit_label': 'case',
                    'previous_stock': 0,
                    'updated_stock': 350,
                    'case_capacity_snapshot': prod.quantity_per_unit or 24,
                    'case_count_snapshot': 350
                }
            )

    def seed_customers(self, sorted_outlets, outlets_count, client_pass_hash):
        self.stdout.write(f"Seeding Top {outlets_count} Customer Outlets from Excel...")
        customers_map = {}
        selected_outlets = sorted_outlets[:outlets_count]

        for i, outlet_name in enumerate(selected_outlets):
            loc = LOCATIONS_POOL[i % len(LOCATIONS_POOL)]
            slug = outlet_name.lower().replace(' ', '').replace('.', '').replace('-', '')
            email = f"store.{slug}@pepsiclient.ph"
            phone = f"0917{i+1:03d}{i*7 % 10000:04d}"

            # Create Customer User login
            user, _ = User.objects.get_or_create(
                email=email,
                defaults={
                    'name': f"{outlet_name} Store",
                    'first_name': outlet_name,
                    'last_name': 'Store',
                    'phone': phone,
                    'role': 'customer',
                    'password': client_pass_hash
                }
            )

            # Create Customer entity
            customer, _ = Customer.objects.get_or_create(
                email=email,
                defaults={
                    'name': f"{outlet_name} Store & Refreshments",
                    'first_name': outlet_name,
                    'last_name': 'Store',
                    'phone': phone,
                    'address': loc['address'],
                    'city': loc['city'],
                    'province': 'Negros Occidental',
                    'zip_code': '6100',
                    'latitude': loc['lat'] + (i * 0.0005),
                    'longitude': loc['lng'] + (i * 0.0005),
                    'password': client_pass_hash
                }
            )
            customers_map[outlet_name] = customer

        return customers_map

    def seed_orders(self, parsed_orders, customers_map, products_map, orders_limit):
        self.stdout.write(f"Seeding {orders_limit} Orders from Excel transactions...")
        orders = []
        created_count = 0
        now = timezone.now()

        # Filter parsed orders for our seeded customers
        valid_orders = [o for o in parsed_orders if o['outlet'] in customers_map]

        for idx, o_data in enumerate(valid_orders[:orders_limit]):
            customer = customers_map[o_data['outlet']]
            order_num = f"ORD-PEP-2026-{idx+1:04d}"

            # Distribute statuses: past orders DELIVERED, recent ones IN_TRANSIT / CONFIRMED
            if idx < int(orders_limit * 0.6):
                status = 'DELIVERED'
                order_date = now - timedelta(days=(orders_limit - idx) // 5 + 1)
            elif idx < int(orders_limit * 0.85):
                status = 'IN_TRANSIT'
                order_date = now - timedelta(hours=3)
            else:
                status = 'CONFIRMED'
                order_date = now - timedelta(minutes=45)

            # Calculate total
            line_items = []
            subtotal = Decimal('0.00')

            for col, qty in o_data['items'].items():
                if col in products_map:
                    prod = products_map[col]
                    line_price = prod.case_price * qty
                    subtotal += line_price
                    line_items.append((prod, qty, prod.case_price, line_price))

            if not line_items:
                continue

            order, _ = Order.objects.get_or_create(
                order_number=order_num,
                defaults={
                    'customer': customer,
                    'status': status,
                    'priority': 'NORMAL',
                    'subtotal': subtotal,
                    'total_amount': subtotal,
                    'shipping_cost': Decimal('0.00'),
                    'tax': Decimal('0.00'),
                    'created_at': order_date,
                    'updated_at': order_date
                }
            )

            # Create timeline
            OrderTimeline.objects.get_or_create(
                order=order,
                defaults={
                    'confirmed_at': order_date,
                    'processed_at': order_date + timedelta(minutes=15) if status in ['IN_TRANSIT', 'DELIVERED'] else None,
                    'shipped_at': order_date + timedelta(minutes=45) if status in ['IN_TRANSIT', 'DELIVERED'] else None,
                    'delivered_at': order_date + timedelta(hours=2) if status == 'DELIVERED' else None,
                    'delivery_date': (order_date + timedelta(days=1)).date()
                }
            )

            # Create OrderItems
            for prod, qty, unit_price, total_price in line_items:
                OrderItem.objects.get_or_create(
                    order=order,
                    product=prod,
                    defaults={
                        'product_name': prod.name,
                        'product_sku': prod.sku,
                        'product_unit': prod.unit,
                        'item_type': 'STANDARD',
                        'case_capacity': prod.quantity_per_unit or 24,
                        'quantity': qty,
                        'unit_price': unit_price,
                        'total_price': total_price
                    }
                )

            orders.append(order)
            created_count += 1

        return orders

    def seed_trips(self, warehouse, drivers, vehicles, orders):
        self.stdout.write("Seeding Fleet Delivery Trips & Drop Points...")
        trips = []
        now = timezone.now()

        # Group orders into 3 Trips:
        # Trip 1: Delivered (Yesterday)
        delivered_orders = [o for o in orders if o.status == 'DELIVERED'][:12]
        if delivered_orders:
            t1, _ = Trip.objects.get_or_create(
                trip_number='TRIP-PEP-2026-001',
                defaults={
                    'driver': drivers[0],
                    'vehicle': vehicles[0],
                    'warehouse_id': warehouse.id,
                    'status': 'DELIVERED',
                    'start_latitude': warehouse.latitude,
                    'start_longitude': warehouse.longitude,
                    'planned_start_at': now - timedelta(days=1, hours=8),
                    'actual_start_at': now - timedelta(days=1, hours=8),
                    'actual_end_at': now - timedelta(days=1, hours=2)
                }
            )
            for seq, ord_obj in enumerate(delivered_orders, 1):
                TripDropPoint.objects.get_or_create(
                    trip=t1,
                    order=ord_obj,
                    defaults={
                        'sequence': seq,
                        'status': 'DELIVERED',
                        'location_name': ord_obj.customer.name,
                        'address': ord_obj.customer.address,
                        'city': ord_obj.customer.city,
                        'province': ord_obj.customer.province,
                        'zip_code': ord_obj.customer.zip_code,
                        'latitude': ord_obj.customer.latitude,
                        'longitude': ord_obj.customer.longitude
                    }
                )
            trips.append(t1)

        # Trip 2: In-Transit (Today active trip)
        in_transit_orders = [o for o in orders if o.status == 'IN_TRANSIT'][:8]
        if in_transit_orders:
            t2, _ = Trip.objects.get_or_create(
                trip_number='TRIP-PEP-2026-002',
                defaults={
                    'driver': drivers[1],
                    'vehicle': vehicles[1],
                    'warehouse_id': warehouse.id,
                    'status': 'IN_TRANSIT',
                    'start_latitude': warehouse.latitude,
                    'start_longitude': warehouse.longitude,
                    'planned_start_at': now - timedelta(hours=2),
                    'actual_start_at': now - timedelta(hours=2)
                }
            )
            for seq, ord_obj in enumerate(in_transit_orders, 1):
                dp_status = 'DELIVERED' if seq <= 3 else 'IN_TRANSIT' if seq == 4 else 'PENDING'
                TripDropPoint.objects.get_or_create(
                    trip=t2,
                    order=ord_obj,
                    defaults={
                        'sequence': seq,
                        'status': dp_status,
                        'location_name': ord_obj.customer.name,
                        'address': ord_obj.customer.address,
                        'city': ord_obj.customer.city,
                        'province': ord_obj.customer.province,
                        'zip_code': ord_obj.customer.zip_code,
                        'latitude': ord_obj.customer.latitude,
                        'longitude': ord_obj.customer.longitude
                    }
                )
            # Add telemetry location logs
            for step in range(5):
                LocationLog.objects.create(
                    driver=drivers[1],
                    trip=t2,
                    latitude=10.6720 + (step * 0.003),
                    longitude=122.9385 + (step * 0.003),
                    speed=32.5,
                    heading=45.0,
                    recorded_at=now - timedelta(minutes=15 - step * 3)
                )
            trips.append(t2)

        # Trip 3: Scheduled (Tomorrow)
        confirmed_orders = [o for o in orders if o.status == 'CONFIRMED'][:6]
        if confirmed_orders:
            t3, _ = Trip.objects.get_or_create(
                trip_number='TRIP-PEP-2026-003',
                defaults={
                    'driver': drivers[2],
                    'vehicle': vehicles[2],
                    'warehouse_id': warehouse.id,
                    'status': 'ASSIGNED',
                    'start_latitude': warehouse.latitude,
                    'start_longitude': warehouse.longitude,
                    'planned_start_at': now + timedelta(days=1, hours=8)
                }
            )
            for seq, ord_obj in enumerate(confirmed_orders, 1):
                TripDropPoint.objects.get_or_create(
                    trip=t3,
                    order=ord_obj,
                    defaults={
                        'sequence': seq,
                        'status': 'PENDING',
                        'location_name': ord_obj.customer.name,
                        'address': ord_obj.customer.address,
                        'city': ord_obj.customer.city,
                        'province': ord_obj.customer.province,
                        'zip_code': ord_obj.customer.zip_code,
                        'latitude': ord_obj.customer.latitude,
                        'longitude': ord_obj.customer.longitude
                    }
                )
            trips.append(t3)

        return trips

    def seed_feedback_and_replacements(self, customers_map, orders):
        self.stdout.write("Seeding Sample Feedbacks & Quality Damage Claims...")
        delivered_orders = [o for o in orders if o.status == 'DELIVERED']

        # Feedbacks
        if len(delivered_orders) >= 3:
            Feedback.objects.get_or_create(
                order=delivered_orders[0],
                customer=delivered_orders[0].customer,
                defaults={
                    'type': 'DELIVERY_FEEDBACK',
                    'subject': 'Fast and reliable delivery!',
                    'message': 'Driver arrived early and all cases of Mountain Dew were in perfect chilled condition.',
                    'rating': 5
                }
            )
            Feedback.objects.get_or_create(
                order=delivered_orders[1],
                customer=delivered_orders[1].customer,
                defaults={
                    'type': 'PRODUCT_QUALITY',
                    'subject': 'Great service as always',
                    'message': 'Smooth delivery to our store in Talisay. Pepsi 1L and Gatorade were well packed.',
                    'rating': 5
                }
            )
            Feedback.objects.get_or_create(
                order=delivered_orders[2],
                customer=delivered_orders[2].customer,
                defaults={
                    'type': 'GENERAL',
                    'subject': 'Slight delivery delay but polite driver',
                    'message': 'Delivery arrived 20 mins after ETA due to traffic, but driver Carlos was very courteous.',
                    'rating': 4
                }
            )

        # Replacement claim (Defective / Damaged items)
        if delivered_orders:
            target_order = delivered_orders[0]
            first_item = target_order.items.first()
            if first_item:
                rep, _ = Replacement.objects.get_or_create(
                    replacement_number='REP-PEP-2026-0001',
                    order=target_order,
                    defaults={
                        'customer_id': target_order.customer.id,
                        'reason': 'Broken seal / transit leakage during unloading',
                        'description': f"Defect verified on 4 bottles of {first_item.product_name}.",
                        'status': 'APPROVED',
                        'requested_by': 'CUSTOMER',
                        'replacement_mode': 'DIRECT_REDELIVERY',
                        'original_order_item_id': first_item.id,
                        'replacement_product_id': first_item.product.id if first_item.product else None,
                        'replacement_quantity': 4,
                        'pickup_address': target_order.customer.address,
                        'pickup_city': target_order.customer.city,
                        'pickup_province': target_order.customer.province,
                        'pickup_zip_code': target_order.customer.zip_code
                    }
                )
                ReplacementLine.objects.get_or_create(
                    replacement=rep,
                    product_name=first_item.product_name,
                    defaults={
                        'product_sku': first_item.product_sku,
                        'base_unit_label': 'bottle',
                        'requested_base_units': 4,
                        'replaced_base_units': 4,
                        'returned_base_units': 4,
                        'reason': 'Broken seal',
                        'description': 'Replaced with fresh stock from Bay-Cold-B',
                        'product': first_item.product,
                        'original_order_item': first_item
                    }
                )
