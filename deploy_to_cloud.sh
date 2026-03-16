#!/bin/bash

# Configuration
PROJECT_ID="waybackhome-peedj1xin7k8vg1yty"
SERVICE_NAME="nexus-comm-link"
REGION="us-central1"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "🚀 Starting deployment of $SERVICE_NAME to Google Cloud Run..."

# 1. Build and push the image using Cloud Build
echo "📦 Building and pushing Docker image using Cloud Build..."
gcloud builds submit --tag $IMAGE_NAME .

# 2. Deploy to Cloud Run
echo "☁️ Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_VOICE_MODEL=models/gemini-2.5-flash-native-audio-preview-09-2025"

echo "✅ Deployment complete!"
gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)'
