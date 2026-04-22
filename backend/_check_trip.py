import sqlite3
conn = sqlite3.connect("db.sqlite3")
c = conn.cursor()
c.execute("SELECT id, trip_number, status, total_drop_points, completed_drop_points FROM Trip")
trips = c.fetchall()
print("=== TRIPS ===")
for t in trips:
    print(f"  id={t[0]}, number={t[1]}, status={t[2]}, total_dp={t[3]}, completed_dp={t[4]}")

c.execute("SELECT id, trip_id, sequence, status, location_name, order_id FROM TripDropPoint ORDER BY trip_id, sequence")
dps = c.fetchall()
print("\n=== DROP POINTS ===")
for dp in dps:
    print(f"  id={dp[0]}, trip_id={dp[1]}, seq={dp[2]}, status={dp[3]}, location={dp[4]}, order_id={dp[5]}")
conn.close()
