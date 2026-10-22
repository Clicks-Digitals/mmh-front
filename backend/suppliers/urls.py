from django.urls import path

from suppliers.views import OneEpinCallbackView, OneEpinReconcileView

urlpatterns = [
    # Preferred: token in the X-Callback-Token header.
    path("1epin/callback/", OneEpinCallbackView.as_view()),
    # Legacy: token in the path (kept for already-registered callback URLs).
    path("1epin/callback/<str:token>/", OneEpinCallbackView.as_view()),
    path("1epin/reconcile/", OneEpinReconcileView.as_view()),
]
