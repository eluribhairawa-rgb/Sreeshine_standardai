#!/usr/bin/env python3
"""Entry point for Swecha diagnostic parameter seeding (delegates to seed_swecha_catalogue_parameters).

Usage:
    python seed_swecha_parameters.py --dry-run
    python seed_swecha_parameters.py
    python seed_swecha_parameters.py --force --dry-run
"""
import sys

from seed_swecha_catalogue_parameters import (  # noqa: F401
    TEMPLATES,
    main,
    normalise,
    seed_parameters,
    template_for,
)

if __name__ == "__main__":
    sys.exit(main())
