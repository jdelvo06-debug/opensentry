# SKYSHIELD

Open-source browser-based C-UAS (Counter-Unmanned Aerial Systems) training simulator. Practice detecting, classifying, and responding to drone threats in a realistic tactical operations center environment.

![Radar Screenshot](docs/screenshots/radar-placeholder.png)

## Features

- **Radar Display** -- HTML5 Canvas with green phosphor aesthetic, rotating sweep line, and fading threat blips
- **Threat Scenarios** -- JSON-based scenario files with realistic drone behaviors
- **Decision Making** -- Choose from RF jamming, GPS spoofing, kinetic response, interceptor drones, directed energy, or passive observation
- **Scoring System** -- Graded on response time, correct identification, proportionality, collateral avoidance, and ROE compliance
- **Real-time Simulation** -- WebSocket-driven state updates at 10Hz

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+

### Install

```bash
make install
```

### Run

```bash
make dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

## Architecture

```
Browser (React + Canvas) <--WebSocket--> Python Backend (FastAPI)
                                           |
                                     Scenario Engine
                                     Scoring Engine
                                     Drone AI / Physics
```

## Scenarios

Scenarios are defined as JSON files in `backend/scenarios/`. See `lone_wolf.json` for the format.

| Scenario | Description | Difficulty |
|----------|-------------|------------|
| Lone Wolf | Commercial quad, direct approach | Easy |

## Scoring

| Factor | Weight |
|--------|--------|
| Response Time | 25% |
| Correct ID | 30% |
| Proportionality | 20% |
| Collateral Avoidance | 15% |
| ROE Compliance | 10% |

Grades: **S** (Perfect) > **A** > **B** > **C** > **F** (Base compromised)

## Tech Stack

- **Frontend:** React + TypeScript + Vite + HTML5 Canvas
- **Backend:** Python + FastAPI + WebSocket
- **Data:** JSON scenario files

## OPSEC

All scenarios are based on **unclassified, publicly available** threat data. No real unit names, locations, or TTPs. Drone behaviors based on commercial UAS specs. Countermeasure effectiveness based on published vendor data.

## License

MIT -- see [LICENSE](LICENSE)
