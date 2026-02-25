import { create } from 'zustand';

type Variant = 'danger' | 'warning' | 'info';

interface ConfirmationOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
}

interface ConfirmationState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: Variant;
  isAlert: boolean;
  resolve: ((value: boolean) => void) | null;
}

const initialState: Omit<ConfirmationState, 'resolve'> = {
  isOpen: false,
  title: '',
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  variant: 'info',
  isAlert: false,
};

export const useConfirmationStore = create<ConfirmationState>(() => ({
  ...initialState,
  resolve: null,
}));

function open(opts: ConfirmationOptions & { isAlert: boolean }): Promise<boolean> {
  // Resolve any pending confirmation
  const prev = useConfirmationStore.getState().resolve;
  if (prev) prev(false);

  return new Promise<boolean>((resolve) => {
    useConfirmationStore.setState({
      isOpen: true,
      title: opts.title ?? (opts.isAlert ? 'Notice' : 'Confirm'),
      message: opts.message,
      confirmText: opts.confirmText ?? (opts.isAlert ? 'OK' : 'Confirm'),
      cancelText: opts.cancelText ?? 'Cancel',
      variant: opts.variant ?? 'info',
      isAlert: opts.isAlert,
      resolve,
    });
  });
}

export function showConfirmation(opts: ConfirmationOptions): Promise<boolean> {
  return open({ ...opts, isAlert: false });
}

export function showAlert(opts: Omit<ConfirmationOptions, 'cancelText'>): Promise<void> {
  return open({ ...opts, isAlert: true }).then(() => {});
}

export function closeConfirmation(result: boolean) {
  const { resolve } = useConfirmationStore.getState();
  if (resolve) resolve(result);
  useConfirmationStore.setState({ ...initialState, resolve: null });
}
