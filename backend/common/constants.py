# Shortened demo paths. Production-style retail PSP flows are often 5–6 hops
# (merchant → PSP → switch/processing → gateway → settlement bank → ledger).
# CRYPTO_PATH is the hackathon showcase: fiat in, stablecoin/FX leg, fiat settlement out.
STANDARD_PATH = ["merchant", "gateway", "bank"]
CRYPTO_PATH = ["merchant", "gateway", "crypto_exchange", "bank"]

# Merchant metadata.payment_rail — surfaced on GraphSnapshot for operators
PAYMENT_RAIL_CARD = "card_acquiring"
PAYMENT_RAIL_TRANSFER = "bank_transfer"
PAYMENT_RAIL_CRYPTO = "crypto_settlement"
