from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, get_db
import models

from routers import auth, users, datasets, chat, ai, documents, whatsapp
from services.logger import setup_logger

# Setup root logger
setup_logger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    
    # Auto-seed Client for WhatsApp chatbot if database is empty/reset
    from database import SessionLocal
    from models import User, Client
    import bcrypt
    
    db = SessionLocal()
    try:
        # Ensure dev user exists
        dev_user = db.query(User).filter(User.email == "dev@localhost.com").first()
        if not dev_user:
            dev_pass_hash = bcrypt.hashpw("devpassword123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
            dev_user = User(
                name="Dev User",
                email="dev@localhost.com",
                password_hash=dev_pass_hash,
                role="user",
                is_verified=True,
            )
            db.add(dev_user)
            db.flush()
            
        # Ensure Dev Gym Studio client exists
        client = db.query(Client).filter(Client.whatsapp_number == "15556447104").first()
        if not client:
            client = Client(
                user_id=dev_user.id,
                business_name="Dev Gym Studio",
                niche="gym",
                whatsapp_number="15556447104",
                is_active=True,
            )
            db.add(client)
            
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()
        
    yield


app = FastAPI(
    title="AI Data Analyst Platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex="https://.*\\.vercel\\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "running"}


@app.get("/debug-clients", tags=["Health"])
def debug_clients(db = Depends(get_db)):
    from models import Client
    clients = db.query(Client).all()
    return [{"id": str(c.id), "business_name": c.business_name, "whatsapp_number": c.whatsapp_number, "is_active": c.is_active} for c in clients]



app.include_router(auth.router,     prefix="/auth",     tags=["Auth"])
app.include_router(users.router,    prefix="/users",    tags=["Users"])
app.include_router(datasets.router, prefix="/datasets", tags=["Datasets"])
app.include_router(chat.router,     prefix="/chat",     tags=["Chat"])
app.include_router(ai.router,       prefix="/ai",       tags=["AI"])
app.include_router(documents.router, prefix="/documents", tags=["Documents"])
app.include_router(whatsapp.router,  prefix="/whatsapp",  tags=["WhatsApp"])