from app.shared.blueprint.backend import blueprint_catalog_service


def get_active_blueprints(project):
    return blueprint_catalog_service.get_active_blueprints(project)


__all__ = ["get_active_blueprints"]
