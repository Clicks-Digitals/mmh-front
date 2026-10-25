"""Local-dev console e-mail backend that never crashes on non-ASCII text.

Django's console backend writes to ``sys.stdout``; on Windows that stream is often a
legacy code page (cp1252) and Arabic e-mails raise ``UnicodeEncodeError``. This backend
writes UTF-8 bytes to the underlying buffer when the text stream cannot encode the
message (or falls back to backslash escapes). SMTP is not affected.
"""

from __future__ import annotations

from django.core.mail.backends.console import EmailBackend as DjangoConsoleEmailBackend


class SafeConsoleStream:
    def __init__(self, stream):
        self._stream = stream

    def write(self, text: str):
        try:
            return self._stream.write(text)
        except UnicodeEncodeError:
            buffer = getattr(self._stream, "buffer", None)
            if buffer is not None:
                self._stream.flush()
                written = buffer.write(text.encode("utf-8"))
                buffer.flush()
                return written
            encoding = getattr(self._stream, "encoding", None) or "ascii"
            return self._stream.write(text.encode(encoding, errors="backslashreplace").decode(encoding))

    def flush(self):
        return self._stream.flush()

    def __getattr__(self, name):
        return getattr(self._stream, name)


class EmailBackend(DjangoConsoleEmailBackend):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.stream = SafeConsoleStream(self.stream)
