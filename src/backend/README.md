# Backend - Graduation Thesis

This is the backend component of the graduation thesis project, built with **Python** and **FastAPI**.

## Features

- **FastAPI Core**: High-performance asynchronous API framework.
- **Terraform Integration**: Uses `python-terraform` for infrastructure management.
- **RESTful Endpoints**: Modular router structure for easy extension.

## Setup

1.  **Navigate to directory:**
    ```bash
    cd src/backend
    ```

2.  **Create virtual environment:**
    ```bash
    python -m venv venv
    source venv/bin/activate  # Windows: venv\Scripts\activate
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run server:**
    ```bash
    uvicorn main:app --reload --port 8000
    ```

## Structure

- `main.py`: Entry point and application setup.
- `requirements.txt`: Python dependencies.
- `venv/`: Local environment (ignored by git).
