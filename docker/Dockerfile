FROM apache/spark:3.5.7-scala2.12-java17-python3-ubuntu@sha256:7897b9a69efa94caccc52579e310a2fe68fb75b88a3d55b97b31568e5e233176

USER root
COPY requirements.txt /tmp/workshop-requirements.txt
RUN python3 -m pip install --no-cache-dir -r /tmp/workshop-requirements.txt

ENV PYTHONPATH=/workspace/src:/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.7-src.zip \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYSPARK_PYTHON=python3 \
    SPARK_LOCAL_IP=127.0.0.1 \
    WORKSHOP_STATE_DIR=/state
WORKDIR /workspace
COPY --chown=185:0 src /workspace/src
COPY --chown=185:0 config /workspace/config
COPY --chown=185:0 tests /workspace/tests
COPY --chown=185:0 pyproject.toml /workspace/pyproject.toml
USER 185
ENTRYPOINT ["python3", "-m", "news_pipeline"]
CMD ["--help"]
