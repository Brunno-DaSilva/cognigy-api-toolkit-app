import Modal from "./Modal";

const ConfirmDialog = ({
  open,
  title = "Confirm",
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}) => (
  <Modal
    open={open}
    onClose={busy ? undefined : onCancel}
    title={title}
    footer={
      <>
        <button
          type="button"
          className="btn-ghost"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={destructive ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </>
    }
  >
    <p className="modal-message">{message}</p>
  </Modal>
);

export default ConfirmDialog;
