# Graduation Thesis Project

This project contains the source code for the graduation thesis. It is structured into frontend and backend components.

## Structure

- `src/frontend`: Next.js frontend application.
- `src/backend`: Python/FastAPI backend API (or relevant backend).
- `references`: Thesis references (PDFs, docs).

## Installation & Deployment

### Prerequisites

- Node.js (v18+)
- Python (v3.10+)
- Docker & Docker Compose (optional)
- pnpm (recommended for frontend)

### Running Locally

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/png261/graduation-thesis.git
    cd graduation-thesis
    ```

2.  **Frontend:**
    ```bash
    cd src/frontend
    pnpm install
    # Create .env.local based on .env.example
    pnpm dev
    ```
    Access at `http://localhost:3000`.

3.  **Backend:**
    ```bash
    cd src/backend
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    pip install -r requirements.txt
    uvicorn main:app --reload
    ```
    Access API at `http://localhost:8000`.

## Features
- AI Chat Interface (Gemini integration)
- Thesis Management System (placeholder)

## References
See the `/references` directory for related papers and documentation.
# hcp-terraform
