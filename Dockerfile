# --- Build stage ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY NhlFantasyLeague.api.csproj ./
RUN dotnet restore

COPY . .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# --- Runtime stage ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# Force port 10000. The .NET 8 base image defaults to 8080 internally,
# which conflicts with Render's expected port and causes no-server.
ENV ASPNETCORE_HTTP_PORTS=10000

EXPOSE 10000
ENTRYPOINT ["dotnet", "NhlFantasyLeague.api.dll"]