import os
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import (
    create_engine,
    String,
    DateTime,
    JSON,
    ForeignKey,
    Integer,
    Float,
    Boolean,
    Text,
    Numeric,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def business_date(value=None):
    from zoneinfo import ZoneInfo

    value = value or now()
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(ZoneInfo("Asia/Dubai")).date()


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Entity(Base):
    __abstract__ = True
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Role(Entity):
    __tablename__ = "roles"
    name: Mapped[str] = mapped_column(String(80), unique=True)


class Permission(Entity):
    __tablename__ = "permissions"
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))


class Branch(Entity):
    __tablename__ = "branches"
    name: Mapped[str] = mapped_column(String(120))


class User(Entity):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(180), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(200))
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id"))
    branch_id: Mapped[str | None] = mapped_column(ForeignKey("branches.id"), nullable=True)


class Session(Entity):
    __tablename__ = "device_sessions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    refresh_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device: Mapped[str] = mapped_column(String(100))
    expires: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Outlet(Entity):
    __tablename__ = "outlets"
    name: Mapped[str] = mapped_column(String(120))
    branch_id: Mapped[str] = mapped_column(ForeignKey("branches.id"))
    area: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)


class Territory(Entity):
    __tablename__ = "territories"
    name: Mapped[str] = mapped_column(String(120))
    outlet_id: Mapped[str] = mapped_column(ForeignKey("outlets.id"), unique=True)
    radius: Mapped[int] = mapped_column(Integer, default=500)
    tolerance: Mapped[int] = mapped_column(Integer, default=40)
    polygon: Mapped[list] = mapped_column(JSON, default=list)


class Agent(Entity):
    __tablename__ = "agents"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    employee_id: Mapped[str] = mapped_column(String(40), unique=True)
    leader_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    outlet_id: Mapped[str] = mapped_column(ForeignKey("outlets.id"), index=True)
    target: Mapped[int] = mapped_column(Integer, default=20)
    status: Mapped[str] = mapped_column(String(40), default="OFFLINE")
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float] = mapped_column(Float, default=12)
    geofence: Mapped[str] = mapped_column(String(30), default="IN BOUNDS")
    last_sync: Mapped[datetime] = mapped_column(DateTime, default=now)


class Shift(Entity):
    __tablename__ = "shifts"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Customer(Entity):
    __tablename__ = "customers"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    arabic_name: Mapped[str] = mapped_column(String(120), default="")
    mobile: Mapped[str] = mapped_column(String(40), index=True)
    nationality: Mapped[str] = mapped_column(String(80), default="Demo")


class Document(Entity):
    __tablename__ = "customer_documents"
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    document_type: Mapped[str] = mapped_column(String(60))
    encrypted_number: Mapped[str] = mapped_column(Text)
    expiry: Mapped[str] = mapped_column(String(10))


class Ekyc(Entity):
    __tablename__ = "ekyc_sessions"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    status: Mapped[str] = mapped_column(String(30), index=True)
    confidence: Mapped[float] = mapped_column(Float)
    result: Mapped[dict] = mapped_column(JSON, default=dict)


class Product(Entity):
    __tablename__ = "products"
    name: Mapped[str] = mapped_column(String(120))
    sales_type: Mapped[str] = mapped_column(String(40), default="New connection")


class Plan(Entity):
    __tablename__ = "plans"
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"))
    name: Mapped[str] = mapped_column(String(120))
    monthly_cost: Mapped[float] = mapped_column(Float)
    data_gb: Mapped[int] = mapped_column(Integer)
    speed: Mapped[str] = mapped_column(String(50), default="5G")
    roaming: Mapped[str] = mapped_column(String(60), default="2 GB")
    contract: Mapped[str] = mapped_column(String(60), default="12 months")
    promotion: Mapped[str] = mapped_column(String(120), default="")
    advance: Mapped[float] = mapped_column(Float, default=0)
    vat: Mapped[float] = mapped_column(Float, default=5)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Sim(Entity):
    __tablename__ = "sim_inventory"
    iccid: Mapped[str] = mapped_column(String(60), unique=True)
    serial: Mapped[str] = mapped_column(String(60), unique=True)
    sim_type: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(40), default="AVAILABLE", index=True)
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id"), nullable=True, index=True)
    outlet_id: Mapped[str] = mapped_column(ForeignKey("outlets.id"), index=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Movement(Entity):
    __tablename__ = "inventory_movements"
    sim_id: Mapped[str] = mapped_column(ForeignKey("sim_inventory.id"), index=True)
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agents.id"), nullable=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    old_status: Mapped[str] = mapped_column(String(40))
    new_status: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(String(300))


class Order(Entity):
    __tablename__ = "orders"
    reference: Mapped[str] = mapped_column(String(40), unique=True)
    request_id: Mapped[str] = mapped_column(String(40), unique=True)
    sr_id: Mapped[str] = mapped_column(String(40), unique=True)
    msisdn: Mapped[str] = mapped_column(String(40), index=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    plan_id: Mapped[str | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    sim_id: Mapped[str | None] = mapped_column(ForeignKey("sim_inventory.id"), nullable=True)
    ekyc_id: Mapped[str | None] = mapped_column(ForeignKey("ekyc_sessions.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    draft: Mapped[dict] = mapped_column(JSON, default=dict)
    operation_id: Mapped[str] = mapped_column(String(80), unique=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    handling_seconds: Mapped[int] = mapped_column(Integer, default=0)


class Activation(Entity):
    __tablename__ = "activations"
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), unique=True)
    provider_reference: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(30))


class OrderEvent(Entity):
    __tablename__ = "order_events"
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    actor: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(120))


class Location(Entity):
    __tablename__ = "location_events"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float] = mapped_column(Float)
    distance: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(30))


class Alert(Entity):
    __tablename__ = "compliance_alerts"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    title: Mapped[str] = mapped_column(String(150))
    severity: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30), default="OPEN")
    note: Mapped[str] = mapped_column(String(500), default="")


class Notification(Entity):
    __tablename__ = "notifications"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    message: Mapped[str] = mapped_column(String(250))
    read: Mapped[bool] = mapped_column(Boolean, default=False)


class Audit(Entity):
    __tablename__ = "audit_events"
    user_id: Mapped[str] = mapped_column(String(36))
    actor: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(120), index=True)
    entity: Mapped[str] = mapped_column(String(100), index=True)
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    old_value: Mapped[dict] = mapped_column(JSON, default=dict)
    new_value: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(String(300), default="")
    source: Mapped[str] = mapped_column(String(50), default="API")
    device: Mapped[str] = mapped_column(String(100), default="")
    ip: Mapped[str] = mapped_column(String(80), default="")


class Event(Entity):
    __tablename__ = "events"
    agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(80))



class KycCapture(Entity):
    __tablename__ = "kyc_captures"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    creator_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    operation_id: Mapped[str] = mapped_column(String(80), unique=True)
    source_reference: Mapped[str] = mapped_column(String(120))
    image_hash: Mapped[str] = mapped_column(String(64))
    image_type: Mapped[str] = mapped_column(String(20))
    image_encrypted: Mapped[str] = mapped_column(Text)
    payload_encrypted: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="QUEUED", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    error: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class FieldTask(Entity):
    __tablename__ = "field_tasks"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    note: Mapped[str] = mapped_column(String(500), default="")
    due_date: Mapped[str] = mapped_column(String(10), index=True)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Incentive(Entity):
    __tablename__ = "incentives"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    note: Mapped[str] = mapped_column(String(300), default="")
    source: Mapped[str] = mapped_column(String(10))
    batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="RECORDED")


class SupportTicket(Entity):
    __tablename__ = "support_tickets"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    subject: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(20), default="OPEN", index=True)
    response: Mapped[str] = mapped_column(String(1000), default="")


engine = create_engine(os.getenv("DATABASE_URL", "sqlite:///./relay.db"), pool_pre_ping=True)
if engine.dialect.name == "sqlite":
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")


DB = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with DB() as db:
        yield db
