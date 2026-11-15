FROM python:3.12-slim

ARG INSTALL_OSMNX=false
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

COPY requirements.txt requirements-dev.txt requirements-osm.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt \
    && if [ "$INSTALL_OSMNX" = "true" ]; then pip install --no-cache-dir -r requirements-osm.txt; fi

COPY . .

EXPOSE 8000
CMD ["sh", "scripts/start.sh"]
