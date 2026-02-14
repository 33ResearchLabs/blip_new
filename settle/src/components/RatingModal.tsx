'use client';

import { useState } from 'react';
import { Star, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface RatingModalProps {
  orderId: string;
  counterpartyName: string;
  counterpartyType: 'user' | 'merchant';
  raterType: 'user' | 'merchant';
  raterId: string;
  onClose: () => void;
  onSubmit: (rating: number, review: string) => Promise<void>;
}

export function RatingModal({
  orderId,
  counterpartyName,
  counterpartyType,
  raterType,
  raterId,
  onClose,
  onSubmit,
}: RatingModalProps) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [review, setReview] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit(rating, review);
      onClose();
    } catch (error) {
      console.error('Failed to submit rating:', error);
      alert('Failed to submit rating. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const ratingLabels = [
    'Poor',
    'Fair',
    'Good',
    'Very Good',
    'Excellent',
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-[#0d0d0d] rounded-2xl w-full max-w-md border border-white/[0.08] shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
            <div>
              <h2 className="text-lg font-semibold text-white">Rate Transaction</h2>
              <p className="text-sm text-white/50 mt-0.5">
                How was your experience with {counterpartyName}?
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5 text-white/60" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {/* Star Rating */}
            <div className="flex flex-col items-center mb-6">
              <div className="flex gap-2 mb-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className={`w-10 h-10 transition-colors ${
                        star <= (hoverRating || rating)
                          ? 'fill-[#c9a962] text-[#c9a962]'
                          : 'text-white/20'
                      }`}
                    />
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <motion.p
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm font-medium text-[#c9a962]"
                >
                  {ratingLabels[rating - 1]}
                </motion.p>
              )}
            </div>

            {/* Review Text (Optional) */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-white/70 mb-2">
                Add a review (optional)
              </label>
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                placeholder="Share your experience..."
                maxLength={500}
                rows={4}
                className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-white placeholder:text-white/30 focus:outline-none focus:border-[#c9a962]/50
                           resize-none"
              />
              <p className="text-xs text-white/40 mt-1">
                {review.length}/500 characters
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 rounded-lg border border-white/[0.08]
                           text-white/70 hover:bg-white/5 transition-colors font-medium"
              >
                Skip for Now
              </button>
              <button
                onClick={handleSubmit}
                disabled={rating === 0 || isSubmitting}
                className="flex-1 px-4 py-3 rounded-lg bg-[#c9a962] text-black font-medium
                           hover:bg-[#d4b76e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Rating'
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
