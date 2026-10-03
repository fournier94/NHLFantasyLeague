# --- Build stage ---
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore first so the layer cache is reused when only source files change
COPY NhlFantasyLeague.api.csproj ./
RUN dotnet restore

# Copy the rest of the backend and publish
COPY . .
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# --- Runtime stage ---
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# .NET 8 ASP.NET Core images listen on port 8080 by default.
EXPOSE 10000

ENTRYPOINT ["dotnet", "NhlFantasyLeague.api.dll"]