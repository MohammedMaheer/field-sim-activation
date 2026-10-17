"""Read optimizations preserve the original agent view and account isolation."""
from uuid import uuid4
from sqlalchemy import event,select
from test_client_scope import database,client,login
from app.db import Agent,Customer,DB,User,engine
from app.services import agent_view,agent_views,retain_agent_references


def test_batched_agent_rows_match_individual_views_with_constant_related_queries(database):
    with DB() as db:
        source=db.scalar(select(Agent))
        source_user=db.get(User,source.user_id)
        created=[]
        for index in range(20):
            user=User(name=f"Isolated list QA {index}",email=f"list-{uuid4().hex}@example.test",password_hash=source_user.password_hash,role_id=source_user.role_id)
            db.add(user);db.flush()
            agent=Agent(user_id=user.id,employee_id="LIST-"+uuid4().hex[:12],leader_id=source.leader_id,outlet_id=source.outlet_id,target=20,lat=0,lng=0)
            db.add(agent);db.flush();created.append((agent.id,user.id))
        db.commit()
    try:
        with DB() as db:
            agents=list(db.scalars(select(Agent).order_by(Agent.id)))
            expected=[agent_view(db,agent) for agent in agents]
        statements=[]
        def capture(*args): statements.append(args[2])
        with DB() as db:
            agents=list(db.scalars(select(Agent).order_by(Agent.id)))
            event.listen(engine,"before_cursor_execute",capture)
            try: actual=agent_views(db,agents)
            finally: event.remove(engine,"before_cursor_execute",capture)
        assert actual==expected
        assert len(statements)<=7, len(statements)
    finally:
        with DB() as db:
            for agent_id,user_id in created:
                db.delete(db.get(Agent,agent_id));db.delete(db.get(User,user_id))
            db.commit()


def test_reference_rows_do_not_escape_the_request_session(database):
    with DB() as db:
        agent=db.scalar(select(Agent));user_id=agent.user_id
        retain_agent_references(db,[agent])
        original=db.get(User,user_id).name
    try:
        with DB() as db:
            db.get(User,user_id).name="Changed in another session";db.commit()
        with DB() as db:
            assert "workspace_read_references" not in db.info
            agent=db.scalar(select(Agent).where(Agent.user_id==user_id))
            assert agent_views(db,[agent])[0]["name"]=="Changed in another session"
    finally:
        with DB() as db:
            db.get(User,user_id).name=original;db.commit()


def test_customer_list_does_not_reload_branch_for_each_historical_customer(database):
    from app.main import records
    created=[]
    with DB() as db:
        agent=db.scalar(select(Agent))
        for index in range(40):
            row=Customer(agent_id=agent.id,name=f"Historical customer {index}",mobile="0500000000",nationality="Not recorded")
            db.add(row);db.flush();created.append(row.id)
        db.commit()
    try:
        statements=[]
        def capture(*args): statements.append(args[2])
        with DB() as db:
            user=db.scalar(select(User).where(User.email=="admin@relay.demo"))
            event.listen(engine,"before_cursor_execute",capture)
            try: rows=records("customers",db,user)
            finally: event.remove(engine,"before_cursor_execute",capture)
        assert set(created)<=set(row["id"] for row in rows)
        branch_queries=[sql for sql in statements if "FROM branches" in sql]
        outlet_queries=[sql for sql in statements if "FROM outlets" in sql]
        assert len(branch_queries)<=1
        assert len(outlet_queries)<=1
    finally:
        with DB() as db:
            for row_id in created: db.delete(db.get(Customer,row_id))
            db.commit()
