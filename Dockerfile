FROM apache/spark:3.5.7-scala2.12-java17-python3-ubuntu@sha256:7897b9a69efa94caccc52579e310a2fe68fb75b88a3d55b97b31568e5e233176

USER root
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m pip install --no-cache-dir --no-deps -r /tmp/requirements.txt

ENV PYTHONPATH=/workspace/src:/workspace:/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.7-src.zip \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYSPARK_PYTHON=python3 \
    SPARK_LOCAL_IP=127.0.0.1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
    PYSPARK_SUBMIT_ARGS="--driver-memory 1g --master local[1] pyspark-shell"
WORKDIR /workspace
COPY pyproject.toml /workspace/
COPY src /workspace/src
COPY config /workspace/config
COPY tests /workspace/tests
COPY scripts /workspace/scripts
ENTRYPOINT ["python3"]
CMD ["-m", "predict"]
