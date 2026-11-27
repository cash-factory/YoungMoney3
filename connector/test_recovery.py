import json
import sqlite3
import unittest

from spec_evidence import first_position_spec
from recovery import history_window, due_positions, mark_checked

class SpecAndRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.executescript("""
          CREATE TABLE position_specs(link TEXT,position_id TEXT,payload TEXT,observed_at_ms INTEGER,PRIMARY KEY(link,position_id));
          CREATE TABLE position_observations(link TEXT,position_id TEXT,at_ms INTEGER,sl TEXT,tp TEXT,PRIMARY KEY(link,position_id,at_ms));
          CREATE TABLE position_recovery(link TEXT,position_id TEXT,status TEXT NOT NULL,checked_ms INTEGER NOT NULL,PRIMARY KEY(link,position_id));
        """)
        self.events=[]
        self.enqueue=lambda *args:self.events.append(args)

    def test_same_symbol_for_seven_positions_does_not_collide(self):
        lookup=lambda:{"symbol":"EURUSD","trade_calc_mode":0,"trade_tick_size":0.00001,"trade_tick_value":1.0,"bid":1.22}
        for i in range(7):
            first_position_spec(self.db,"link",10000+i,200000,lookup,self.enqueue)
        self.assertEqual(len(self.events),7)
        keys=[event[2] for event in self.events]
        self.assertEqual(len(set(keys)),7,'Different positions sharing EURUSD must have distinct immutable keys')
        self.assertTrue(all(key.startswith('spec-') for key in keys))
        self.assertTrue(all(event[3]['specification_provenance']=='first_observed_at_connector_not_proven_at_entry'
                            for event in self.events))
        self.assertEqual({event[3]['position_id'] for event in self.events},
                         {str(10000+i) for i in range(7)})
        for i in range(7):
            changed=lambda:{"symbol":"EURUSD","bid":1.9999,"trade_tick_value":1.1}
            value=first_position_spec(self.db,"link",10000+i,300000,changed,self.enqueue)
            self.assertEqual(value["trade_tick_value"],1.0,
                             'Do not silently change initial risk inputs after observing a later price.')
        self.assertEqual(len(self.events),7,'Polling must not append quote-driven specification evidence.')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM position_specs').fetchone()[0],7)

    def test_same_symbol_specifications_scale_to_64_positions_without_collisions(self):
        # Stress fixture: identical symbols on multiple independently tracked positions.
        lookup=lambda:{"symbol":"XAUUSD","trade_calc_mode":0,
                       "trade_tick_size":0.01,"trade_tick_value":1.0,"bid":2467.0}
        for index in range(64):
            first_position_spec(self.db,"link",200000+index,200000,lookup,self.enqueue)
        self.assertEqual(len(self.events),64)
        self.assertEqual(len({event[2] for event in self.events}),64)
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM position_specs WHERE link='link'").fetchone()[0],64)
        for index in range(64):
            first_position_spec(self.db,"link",200000+index,350000,
                                lambda:{"symbol":"XAUUSD","trade_tick_value":7.0},
                                self.enqueue)
        self.assertEqual(len(self.events),64,
            'Repeated polling never overwrites original risk/specification provenance')

    def test_recover_20_40_100_missing_positions_in_successive_batches(self):
        # 16 is an MT5 request budget per polling cycle, NOT a user position cap.
        for count in (20,40,100):
            with self.subTest(positions=count):
                self.db.execute('DELETE FROM position_observations')
                self.db.execute('DELETE FROM position_recovery')
                for index in range(count):
                    self.db.execute("INSERT INTO position_observations VALUES(?,?,?,?,?)",
                                    ('link',str(index),10000,'1.0','2.0'))
                observed=set()
                now=100000
                while len(observed)<count:
                    due,unresolved=due_positions(self.db,'link',set(),now)
                    self.assertLessEqual(len(due),16,'bounded per-cycle broker request budget')
                    self.assertEqual(unresolved,count,'nothing closes without broker deals')
                    self.assertTrue(due,'recovery work must make progress beyond first page')
                    self.assertTrue(set(due).isdisjoint(observed),
                        'unresolved positions must not starve behind recently checked ones')
                    observed.update(due)
                    for pid in due:
                        mark_checked(self.db,'link',pid,now,False)
                    now+=1
                self.assertEqual(len(observed),count)
                self.assertEqual(self.db.execute(
                    "SELECT COUNT(*) FROM position_observations").fetchone()[0],count)
                # Confirm a nontrivial subset with broker-deal evidence.
                for pid in sorted(observed)[::5]:
                    mark_checked(self.db,'link',pid,now,True)
                due,unresolved=due_positions(self.db,'link',set(),now+65000)
                self.assertEqual(unresolved,count-len(sorted(observed)[::5]))
                self.assertLessEqual(len(due),16)
                self.assertEqual(len(due),len(set(due)))

    def test_snapshot_key_and_payload_survive_sqlite_restart(self):
        spec={"symbol":"XAUUSD","trade_tick_size":0.01,"trade_tick_value":1}
        value=first_position_spec(self.db,"a",999,1000,lambda:spec,self.enqueue)
        self.assertEqual(value,spec)
        raw=self.db.execute('SELECT payload FROM position_specs').fetchone()[0]
        self.assertEqual(json.loads(raw)["first_observed_at_ms"],1000)
        first_position_spec(self.db,"a",999,9999,lambda:{"symbol":"UNKNOWN"},self.enqueue)
        self.assertEqual(self.db.execute('SELECT payload FROM position_specs').fetchone()[0],raw)
        self.assertEqual(len(self.events),1)

    def test_verified_closure_is_monotonic_when_broker_history_later_disappears(self):
        self.db.execute('INSERT INTO position_observations VALUES(?,?,?,?,?)',
                        ('link','open-then-closed',10000,'1.2000',None))
        due,unresolved=due_positions(self.db,'link',set(),90000)
        self.assertEqual((due,unresolved),(['open-then-closed'],1))
        mark_checked(self.db,'link','open-then-closed',90000,True)
        self.assertEqual(due_positions(self.db,'link',set(),120000),([],0))
        # A transient empty broker response must not retract the proven close.
        mark_checked(self.db,'link','open-then-closed',121000,False)
        self.assertEqual(due_positions(self.db,'link',set(),190000),([],0))
        self.assertEqual(self.db.execute(
            'SELECT status,checked_ms FROM position_recovery WHERE position_id=?',
            ('open-then-closed',)).fetchone(),('broker_closure_verified',90000))

    def test_repeated_recovery_checks_preserve_unproven_positions(self):
        for pid in range(7):
            self.db.execute('INSERT INTO position_observations VALUES(?,?,?,?,?)',
                            ('link',str(pid),10000,'1.1000','1.2000'))
        for attempt in (100000,161000):
            due,unresolved=due_positions(self.db,'link',set(),attempt)
            self.assertEqual((len(due),unresolved),(7,7))
            for pid in due:
                mark_checked(self.db,'link',pid,attempt,False)
        due,unresolved=due_positions(self.db,'link',{'1','3'},161500)
        self.assertEqual((len(due),unresolved),(0,5))
        due,unresolved=due_positions(self.db,'link',{'1','3'},222001)
        self.assertEqual((len(due),unresolved),(5,5))
        self.assertEqual(self.db.execute(
            'SELECT COUNT(*) FROM position_observations').fetchone()[0],7,
            'Recovery does not invent, erase or duplicate first observations.')

    def test_recovery_uses_bounded_overlapping_history(self):
        day=86400000
        self.assertEqual(history_window(1000,1000,5*day),(1000,1000+day,True))
        self.assertEqual(history_window(1000,2*day,5*day),(day,3*day,True))
        self.assertEqual(history_window(1000,5*day,5*day),(4*day,5*day,False))

    def test_disappeared_positions_require_confirmed_deals_before_closure(self):
        for i in range(7):
            self.db.execute('INSERT INTO position_observations VALUES(?,?,?,?,?)',
                            ('link',str(i),10000,0,0))
        due,unresolved=due_positions(self.db,'link',set(),90000)
        self.assertEqual(len(due),7)
        self.assertEqual(unresolved,7)
        for pid in due[:3]:
            mark_checked(self.db,'link',pid,90000,True)
        mark_checked(self.db,'link',due[3],90000,False)
        due,unresolved=due_positions(self.db,'link',set(),95000)
        self.assertEqual(unresolved,4)
        self.assertNotIn(due[3] if len(due)>3 else '-1',due[:3])
        self.assertEqual(len(due),3,'A still-unverified position must remain pending without a false close.')
        next_due,unresolved=due_positions(self.db,'link',set(),160001)
        self.assertEqual(len(next_due),4)
        self.assertEqual(unresolved,4)
        self.assertEqual(due_positions(self.db,'link',{'4','5','6'},160001)[1],1)

if __name__=='__main__':
    unittest.main()
