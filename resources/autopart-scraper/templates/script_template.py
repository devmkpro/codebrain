#!/usr/bin/env python3
"""
Script standalone de scraping — gerado automaticamente pelo skill autopart-scraper.

Domínio: {domain}
Plano:    plans/{domain}.json

Uso:
    python scripts/scrape_{domain}.py
"""
from motor.core.browser_pool import create_driver, quit_driver
from motor.plan.loader import load_plan
from motor.core.engine import Engine


def main():
    driver = create_driver()
    try:
        plan = load_plan("plans/{domain}.json")
        cfg = {{
            "listing_tabs": 2,
            "detail_tabs": 2,
            "listing_threads": 2,
            "detail_workers": 4,
            "batch": 10,
        }}
        engine = Engine(driver, plan, cfg, site_url=plan.site.base_url)
        engine.run()
    finally:
        quit_driver(driver)


if __name__ == "__main__":
    main()
