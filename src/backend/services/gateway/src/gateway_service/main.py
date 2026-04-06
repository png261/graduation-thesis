from .routes import router
from .runtime import create_app

app = create_app(router)
