import sqlite3

conn = sqlite3.connect(r"c:\CAPSTONE\db\custom.db")
c = conn.cursor()

# Check TripStop (the drop points table)
c.execute("PRAGMA table_info(TripStop)")
cols = [r[1] for r in c.fetchall()]
print("TripStop columns:", cols)

c.execute("SELECT * FROM TripStop ORDER BY tripId, sequence")
rows = c.fetchall()
for r in rows:
    print(dict(zip(cols, r)))

# Check all trips
c.execute("SELECT id, tripNumber, status, totalStops, completedStops FROM Trip")
trips = c.fetchall()
print("\n=== TRIPS ===")
for t in trips:
    print(f"  {t[1]}: status={t[2]}, totalStops={t[3]}, completedStops={t[4]}")

conn.close()
