# Kubernetes Manifests

Kubernetes deployment manifests will live here, organised by service.

Planned structure:

```
k8s/
├── namespace.yaml
├── web/
│   ├── deployment.yaml
│   ├── service.yaml
│   └── ingress.yaml
├── api-gateway/
│   ├── deployment.yaml
│   └── service.yaml
├── trading-engine/
│   ├── deployment.yaml
│   └── service.yaml
├── signal-service/
│   ├── deployment.yaml
│   └── service.yaml
└── configmaps/
    └── app-config.yaml
```

For now, use the Docker Compose stack for local development.
See `docker-compose.yml` in the parent directory.
