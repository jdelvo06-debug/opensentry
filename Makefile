.PHONY: dev backend frontend install clean

# Start both backend and frontend in development mode
dev:
	@echo "Starting SKYSHIELD development servers..."
	@make backend & make frontend & wait

# Start backend only
backend:
	cd backend && python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Start frontend only
frontend:
	cd frontend && npm run dev

# Install all dependencies
install:
	cd backend && pip3 install -r requirements.txt
	cd frontend && npm install

# Clean build artifacts
clean:
	rm -rf frontend/node_modules frontend/dist
	find backend -type d -name __pycache__ -exec rm -rf {} +
