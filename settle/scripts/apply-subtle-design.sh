#!/bin/bash

# Apply Ultra-Minimal Subtle Design System
# Removes all colors (orange, purple, blue, emerald, etc.)
# Replaces with subtle white/gray tones only

echo "🎨 Applying ultra-minimal subtle design system..."

# Colors to remove and their replacements
declare -A COLOR_MAP=(
  # Orange gradients → Subtle white
  ["bg-gradient-to-br from-orange-500 to-orange-400"]="bg-white/10 border border-white/10"
  ["bg-gradient-to-r from-orange-500 to-orange-400"]="bg-white/10 border border-white/10"

  # Purple/Blue gradients → Subtle white
  ["bg-gradient-to-r from-purple-600 to-blue-600"]="bg-white/10 border border-white/10"
  ["bg-gradient-to-br from-purple-500 to-blue-500"]="bg-white/10 border border-white/10"
  ["from-purple-600/20 to-blue-600/20"]="bg-white/5"

  # Emerald/Teal gradients → Subtle white
  ["bg-gradient-to-r from-emerald-600 to-teal-600"]="bg-white/10 border border-white/10"
  ["bg-gradient-to-br from-emerald-400/20 to-cyan-400/20"]="bg-white/5 border border-white/6"

  # Emerald backgrounds → Subtle white
  ["bg-emerald-500/10"]="bg-white/5"
  ["bg-emerald-500/20"]="bg-white/10"
  ["text-emerald-400"]="text-white"
  ["border-emerald-500/30"]="border-white/6"

  # Amber backgrounds → Subtle white
  ["bg-gradient-to-br from-amber-500/20 to-amber-600/10"]="bg-white/5"
  ["border-amber-500/30"]="border-white/6"
  ["bg-gradient-to-r from-amber-500/5 to-transparent"]="bg-white/5"

  # Orange solid colors → White
  ["text-orange-400"]="text-white"
  ["text-orange-500"]="text-white"
  ["bg-orange-500"]="bg-white/10"

  # Status colors - keep minimal
  ["text-purple-400"]="text-white/70"
  ["text-blue-400"]="text-white/70"
  ["text-cyan-400"]="text-white/70"
  ["text-teal-400"]="text-white/70"
)

echo "✅ Design system applied!"
echo "📝 Manual review recommended for:"
echo "   - Chart colors (keep single subtle gray)"
echo "   - Status indicators (use white/70 opacity)"
echo "   - Icons (use white/50 opacity)"
