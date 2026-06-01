// Responsible for the Revit OTP panel and the OTP payload used by switchback JSON.
// Do not put Autodesk Viewer camera logic or issue table UI code here.
(function () {
  class RevitConnectionPanel {
    constructor(statusCallback) {
      this.statusCallback = statusCallback || function () {};
      this.otpKey = 'acc-switchback-revit-otp';
      this.createdAtKey = 'acc-switchback-revit-otp-created-at';
      this.expiresAtKey = 'acc-switchback-revit-otp-expires-at';
      this.maxAgeMs = 12 * 60 * 60 * 1000;
    }

    init() {
      var self = this;

      window.getAccSwitchbackRevitOtp = function () {
        return self.getOrCreateOtp(false).otp;
      };

      window.getAccSwitchbackAuthPayload = function () {
        return self.getSwitchbackOtpPayload();
      };

      var existingOtp = localStorage.getItem(this.otpKey);

      if (existingOtp && /^\d{6}$/.test(existingOtp)) {
        this.syncPanel(false);
      }

      this.bindConnectButton();
      this.bindCopyButton();
      this.bindNewButton();
    }

    bindConnectButton() {
      var button = document.getElementById('connectRevitInstanceButton');
      if (!button) return;

      var self = this;

      button.addEventListener('click', function (event) {
        event.preventDefault();
        self.syncPanel(false);
        self.setStatus('Revit switchback OTP ready. Enter it in the matching Revit add-in instance.');
      });
    }

    bindCopyButton() {
      var copyButton = document.getElementById('copyRevitOtpButton');
      if (!copyButton) return;

      var self = this;

      copyButton.addEventListener('click', function (event) {
        event.preventDefault();

        var otp = self.getOrCreateOtp(false).otp;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(otp).then(function () {
            self.setStatus('Revit OTP copied to clipboard.');
          }).catch(function () {
            self.setStatus('Revit OTP: ' + otp);
          });

          return;
        }

        self.setStatus('Revit OTP: ' + otp);
      });
    }

    bindNewButton() {
      var newButton = document.getElementById('newRevitOtpButton');
      if (!newButton) return;

      var self = this;

      newButton.addEventListener('click', function (event) {
        event.preventDefault();
        self.syncPanel(true);
        self.setStatus('New Revit switchback OTP generated.');
      });
    }

    syncPanel(forceCreate) {
      var panel = document.getElementById('revitConnectionPanel');
      var otpValue = document.getElementById('revitConnectionOtpValue');
      var meta = document.getElementById('revitConnectionOtpMeta');
      var button = document.getElementById('connectRevitInstanceButton');

      if (!panel || !otpValue || !meta) return;

      var otpInfo = this.getOrCreateOtp(!!forceCreate);

      panel.classList.add('connected');
      otpValue.textContent = otpInfo.otp;
      meta.textContent = 'Use this OTP in Revit.';

      if (button) {
        button.textContent = 'Refresh Revit OTP';
      }

      window.accSwitchbackRevitOtp = otpInfo.otp;
      window.accSwitchbackRevitOtpPayload = this.getSwitchbackOtpPayload();
    }

    getSwitchbackOtpPayload() {
      var otpInfo = this.getOrCreateOtp(false);

      return {
        otp: otpInfo.otp,
        createdAtUtc: otpInfo.createdAtUtc,
        expiresAtUtc: otpInfo.expiresAtUtc,
        source: 'web-viewer',
        purpose: 'authorise-revit-switchback-instance'
      };
    }

    getOrCreateOtp(forceNew) {
      var now = Date.now();
      var otp = localStorage.getItem(this.otpKey) || '';
      var createdAt = Number(localStorage.getItem(this.createdAtKey) || 0);
      var expiresAt = Number(localStorage.getItem(this.expiresAtKey) || 0);

      if (this.shouldCreateNewOtp(forceNew, otp, createdAt, expiresAt, now)) {
        otp = this.generateSixDigitOtp();
        createdAt = now;
        expiresAt = now + this.maxAgeMs;

        localStorage.setItem(this.otpKey, otp);
        localStorage.setItem(this.createdAtKey, String(createdAt));
        localStorage.setItem(this.expiresAtKey, String(expiresAt));
      }

      return {
        otp: otp,
        createdAtUtc: new Date(createdAt).toISOString(),
        expiresAtUtc: new Date(expiresAt).toISOString(),
        validForMinutes: Math.max(0, Math.round((expiresAt - now) / 60000))
      };
    }

    shouldCreateNewOtp(forceNew, otp, createdAt, expiresAt, now) {
      if (forceNew) return true;
      if (!/^\d{6}$/.test(otp)) return true;
      if (!createdAt || !expiresAt) return true;
      if (now >= expiresAt) return true;
      if (now - createdAt > this.maxAgeMs) return true;

      return false;
    }

    generateSixDigitOtp() {
      if (window.crypto && window.crypto.getRandomValues) {
        var array = new Uint32Array(1);
        window.crypto.getRandomValues(array);
        return String(100000 + (array[0] % 900000));
      }

      return String(Math.floor(100000 + Math.random() * 900000));
    }

    setStatus(message) {
      this.statusCallback(message);
    }
  }

  window.RevitConnectionPanel = RevitConnectionPanel;
})();
