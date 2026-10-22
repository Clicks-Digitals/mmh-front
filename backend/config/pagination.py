from __future__ import annotations

from rest_framework.pagination import PageNumberPagination


class BoundedPageNumberPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


class LargePageNumberPagination(BoundedPageNumberPagination):
    """Product lists: storefront loads the catalogue in pages of up to 200."""

    max_page_size = 200
