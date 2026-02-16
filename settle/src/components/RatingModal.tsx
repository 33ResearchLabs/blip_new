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

  const ratingLabels = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
  const activeRating = hoverRating || rating;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="glass-card rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Rate Trade</h2>
                <p className="text-[12px] text-white/40 mt-0.5">
                  How was your experience with <span className="text-white/60 font-medium">{counterpartyName}</span>?
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors -mt-1 -mr-1"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>
          </div>

          {/* Stars */}
          <div className="px-5 py-4">
            <div className="flex justify-center gap-3 mb-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="transition-all hover:scale-110 active:scale-95"
                >
                  <Star
                    className={`w-9 h-9 transition-colors ${
                      star <= activeRating
                        ? 'fill-orange-400 text-orange-400'
                        : 'text-white/10 hover:text-white/20'
                    }`}
                  />
                </button>
              ))}
            </div>
            {activeRating > 0 && (
              <motion.p
                key={activeRating}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-[12px] font-bold text-orange-400/80 text-center"
              >
                {ratingLabels[activeRating - 1]}
              </motion.p>
            )}
          </div>

          {/* Review */}
          <div className="px-5 pb-3">
            <textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Add a review (optional)..."
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl
                         text-[12px] text-white placeholder:text-white/20 focus:outline-none focus:border-orange-500/30
                         resize-none transition-colors"
            />
            <p className="text-[10px] text-white/20 mt-1 text-right font-mono">
              {review.length}/500
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 px-5 pb-5">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2.5 rounded-xl border border-white/[0.06]
                         text-[12px] text-white/50 hover:bg-white/[0.04] transition-colors font-medium"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={rating === 0 || isSubmitting}
              className="flex-1 px-3 py-2.5 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 text-black text-[12px] font-bold
                         hover:from-orange-400 hover:to-orange-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed
                         flex items-center justify-center gap-1.5 shadow-[0_2px_12px_rgba(249,115,22,0.15)]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Star className="w-3.5 h-3.5 fill-current" />
                  Submit Rating
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
