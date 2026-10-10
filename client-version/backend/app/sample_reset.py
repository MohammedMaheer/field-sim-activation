"""Explicit owner-authorized operational reset; accounts and plans are preserved."""
import hashlib
import io
import json
from sqlalchemy import select
from PIL import Image, ImageDraw, ImageFont
from .db import (
    DB, User, Plan,
)


def preservation_fingerprint():
    from .db import Permission, Session
    with DB() as db:
        values = {
            'accounts': sorted((u.id, u.name, u.email, u.password_hash, u.role_id) for u in db.scalars(select(User))),
            'permissions': sorted((p.role_id, p.name) for p in db.scalars(select(Permission))),
            'plans': sorted([tuple(str(getattr(p, col.name)) for col in Plan.__table__.columns) for p in db.scalars(select(Plan))]),
            'sessions': sorted((s.id, s.user_id, s.refresh_hash, str(s.expires), s.revoked) for s in db.scalars(select(Session))),
        }
        return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def picture(title, fields):
    image = Image.new('RGB', (1000, max(760, 200 + len(fields) * 62)), '#ffffff')
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype('DejaVuSans.ttf', 26)
    except OSError:
        font = ImageFont.load_default(size=26)
    draw.rectangle((0, 0, 1000, 110), fill='#842757')
    draw.text((40, 35), title, fill='white', font=font)
    for i, (label, value) in enumerate(fields):
        draw.text((40, 150 + i * 62), f'{label}: {value}', fill='#24334a', font=font)
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


def reset_samples():
    from .fresh_samples import refresh_samples
    return refresh_samples(DB)


if __name__ == '__main__':
    reset_samples()
