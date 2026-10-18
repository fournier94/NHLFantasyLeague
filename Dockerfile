# --- Build stage ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY NhlFantasyLeague.api.csproj ./
RUN dotnet restore

COPY . .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# --- Runtime stage ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

# Install postgresql-client-18 so pg_dump is available inside the
# container. The Debian Bookworm default repo only carries PG15, which
# cannot dump a PG18 server (pg_dump must be >= server major version).
# So we add the PGDG apt repo first.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg lsb-release \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get purge -y --auto-remove curl gnupg lsb-release \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/publish .

# Force port 8080. The .NET 8 base image defaults to 8080 internally,
# which is what nginx proxies to.
ENV ASPNETCORE_HTTP_PORTS=8080

EXPOSE 8080

ENTRYPOINT ["dotnet", "NhlFantasyLeague.api.dll"]