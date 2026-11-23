"""Position-scoped, first-observed MT5 symbol specifications.

MetaTrader5.symbol_info contains fields that can change between polls. The
previous 'spec' key hashed *only* these symbol fields, but its payload also
contained position_id. Each simultaneously open position on the same symbol
then appeared as a different immutable record under the same key.

Take one position-scoped snapshot, keep it stable for initial risk projections,
and key exactly the broker payload that is uploaded. Never imply a recovered
snapshot existed at the original entry timestamp.
"""
import hashlib
import json

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),default=str)

def first_position_spec(db,link,position_id,observed_ms,lookup,enqueue):
    position_id=str(position_id)
    cached=db.execute(
        "SELECT payload FROM position_specs WHERE link=? AND position_id=?",
        (link,position_id)).fetchone()
    if cached:
        return json.loads(cached[0])["specification"]
    specification=lookup()
    document={
        "position_id":position_id,
        "first_observed_at_ms":int(observed_ms),
        "specification_provenance":"first_observed_at_connector_not_proven_at_entry",
        "specification":specification,
    }
    # Include position_id in the SHA, preventing identical-symbol collisions.
    key="spec-"+hashlib.sha256(canonical(document).encode("utf-8")).hexdigest()[:28]
    db.execute("INSERT OR IGNORE INTO position_specs(link,position_id,payload,observed_at_ms) VALUES(?,?,?,?)",
               (link,position_id,canonical(document),int(observed_ms)))
    enqueue(link,"raw",key,document)
    return specification
