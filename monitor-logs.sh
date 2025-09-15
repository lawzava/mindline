#!/bin/bash

# Monitor browser logs in real-time
LOG_FILE="logs/browser.log"

# Create logs directory if it doesn't exist
mkdir -p logs

# Create log file if it doesn't exist
touch "$LOG_FILE"

echo "🔍 Monitoring browser logs in real-time..."
echo "📂 Log file: $LOG_FILE"
echo "🚪 Press Ctrl+C to stop"
echo "---"

# Use tail to follow the log file
tail -f "$LOG_FILE"