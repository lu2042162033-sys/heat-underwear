FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN mkdir -p /app/server-data
ENV PORT=3000
EXPOSE 3000
CMD ["python", "server.py"]
