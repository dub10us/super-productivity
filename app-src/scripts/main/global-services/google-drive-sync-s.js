/**
 * @ngdoc service
 * @name superProductivity.GoogleDriveSync
 * @description
 * # GoogleDriveSync
 * Service in the superProductivity.
 */

(() => {
  'use strict';

  const DEFAULT_SYNC_FILE_NAME = 'SUPER_PRODUCTIVITY_SYNC.json';

  class GoogleDriveSync {
    /* @ngInject */
    constructor(AppStorage, GoogleApi, $rootScope, SimpleToast, $mdDialog, $mdToast, $q, $interval, LocalSync) {
      this.AppStorage = AppStorage;
      this.GoogleApi = GoogleApi;
      this.$rootScope = $rootScope;
      this.SimpleToast = SimpleToast;
      this.$mdDialog = $mdDialog;
      this.$mdToast = $mdToast;
      this.$interval = $interval;
      this.LocalSync = LocalSync;
      this.$q = $q;
      this.data = this.$rootScope.r.googleDriveSync;
      this.config = this.$rootScope.r.config.googleDriveSync;

      if (this.config.isEnabled && this.config.isAutoLogin) {
        GoogleApi.login().then(() => {
          if (this.config.isAutoSyncToRemote) {
            this.resetAutoSyncToRemoteInterval();
          }

          if (this.config.isLoadRemoteDataOnStartup) {
            this._checkForInitialUpdate();
          }
        });
      }
    }

    _log() {
      console.log(this.constructor.name + ':', ...arguments);
    }

    _import(loadRes) {
      if (this.LocalSync.isBackupsEnabled()) {
        this.LocalSync.saveBackup();
      }

      const backupData = loadRes.backup;
      const metaData = loadRes.meta;

      // we also need to update the backup to persist it also after the import
      backupData.googleDriveSync.lastLocalUpdate = this.data.lastLocalUpdate = metaData.modifiedDate;
      // and we also need to update last sync to remote, as it kind of happened now
      backupData.googleDriveSync.lastSyncToRemote = this.data.lastSyncToRemote = metaData.modifiedDate;
      // also needs to be set to prevent double upgrades
      backupData.lastActiveTime = new Date();

      this.AppStorage.importData(backupData);
    }

    _isNewerThan(strDate1, strDate2) {
      const d1 = new Date(strDate1);
      const d2 = new Date(strDate2);
      return (d1.getTime() > d2.getTime());
    }

    _isEqual(strDate1, strDate2) {
      const d1 = new Date(strDate1);
      const d2 = new Date(strDate2);
      return (d1.getTime() === d2.getTime());
    }

    _isCurrentPromisePending() {
      return (this.currentPromise && this.currentPromise.$$state.status === 0);
    }

    _getLocalAppData() {
      return this.AppStorage.getCompleteBackupData();
    }

    _formatDate(date) {
      return window.moment(date).format('DD-MM-YYYY --- hh:mm:ss');
    }

    _checkForInitialUpdate() {
      this.currentPromise = this.GoogleApi.getFileInfo(this.data.backupDocId)
        .then((res) => {
          const lastModifiedRemote = res.data.modifiedDate;
          this._log(
            this._formatDate(lastModifiedRemote),
            ' > ',
            this._formatDate(this.data.lastLocalUpdate),
            this._isNewerThan(lastModifiedRemote, this.data.lastLocalUpdate)
          );

          if (this._isNewerThan(lastModifiedRemote, this.data.lastLocalUpdate)) {
            this.SimpleToast('CUSTOM', `There is a remote update! Downloading...`, 'file_upload');

            this._log('HAS CHANGED (modified Date comparision), TRYING TO UPDATE');
            this.loadFrom(true);
          }
        });

      return this.currentPromise;
    }

    _showAsyncToast(promise, msg) {
      const icon = 'file_upload';
      this.$mdToast.show({
        hideDelay: (promise ? (15 * 1000) : (5 * 1000)),
        controller:
        /* @ngInject */
          ($mdToast) => {
            if (promise) {
              promise.then($mdToast.hide, $mdToast.hide);
            }
          },
        template: `
<md-toast>
  <div class="md-toast-content" flex>
    <div class="icon-wrapper">
      <ng-md-icon icon="${icon}"></ng-md-icon>
    </div>
    <div class="toast-text">${msg}</div>
    <md-progress-linear md-mode="indeterminate"
      style="position: absolute; top: 0; left: 0;"></md-progress-linear>
  </div>
</md-toast>`
      });
    }

    _confirmSaveDialog(remoteModified) {
      const lastActiveLocal = this.$rootScope.r.lastActiveTime;

      return this.$mdDialog.show({
        template: `
<md-dialog>
  <md-dialog-content>
    <div class="md-dialog-content">
      <h2 class="md-title" style="margin-top: 0">Overwrite unsaved data on Google Drive?</h2>
      <p>There seem to be some changes on Google Drive, that you don't have locally. Do you want to overwrite them anyway?</p>
      <table> 
        <tr>
          <td>Last modification of remote data:</td>
          <td> ${this._formatDate(remoteModified)}</td>
        </tr>
        <tr>
          <td>Last modification of local data:</td>
          <td> ${this._formatDate(lastActiveLocal)}</td>
        </tr>
        <tr>
          <td>Last sync to remote from this app instance:</td>
          <td> ${this._formatDate(this.data.lastSyncToRemote)}</td>
        </tr>
      </table>
    </div>
  </md-dialog-content>

  <md-dialog-actions>
    <md-button ng-click="saveToRemote()" class="md-primary">
        <ng-md-icon icon="file_upload"
                    aria-label="file_upload"></ng-md-icon> Overwrite remote data
    </md-button>
    <md-button ng-click="loadFromRemote()" class="md-primary">
      <ng-md-icon icon="file_download"
                    aria-label="file_download"></ng-md-icon> Overwrite local data
    </md-button>
    <md-button ng-click="cancel()" class="md-primary md-warn">
      Abort
    </md-button>
  </md-dialog-actions>
</md-dialog>`,
        controller:
        /* @ngInject */
          ($mdDialog, $scope, GoogleDriveSync) => {
            $scope.saveToRemote = () => {
              $mdDialog.hide();
            };

            $scope.loadFromRemote = () => {
              $mdDialog.cancel();
              // we need some time so the promise is canceled
              setTimeout(() => {
                GoogleDriveSync.loadFrom();
              }, 100);
            };

            $scope.cancel = () => {
              $mdDialog.cancel();
            };
          },
      });
    }

    _confirmLoadDialog(remoteModified, lastActiveLocal) {
      return this.$mdDialog.show({
        template: `
<md-dialog>
  <md-dialog-content>
    <div class="md-dialog-content">
      <h2 class="md-title" style="margin-top: 0">Overwrite local data with GDrive Update?</h2>
      <p>Update from Google Drive Backup. <strong>Local data seems to be newer</strong> than the remote data.  Overwrite unsaved local changes? <strong>All data will be lost forever</strong>.</p>
      <table> 
        <tr>
          <td>Last modification of remote data:</td>
          <td> ${this._formatDate(remoteModified)}</td>
        </tr>
        <tr>
          <td>Last modification of local data:</td>
          <td> ${this._formatDate(lastActiveLocal)}</td>
        </tr>
      </table>
    </div>
  </md-dialog-content>

  <md-dialog-actions>
    <md-button ng-click="saveToRemote()" class="md-primary">
      <ng-md-icon icon="file_upload"
                    aria-label="file_upload"></ng-md-icon> Overwrite remote data
    </md-button>
    <md-button ng-click="loadFromRemote()" class="md-primary">
        <ng-md-icon icon="file_download"
                    aria-label="file_download"></ng-md-icon> Overwrite local data
    </md-button>
    <md-button ng-click="cancel()" class="md-primary md-warn">
      Abort
    </md-button>
  </md-dialog-actions>
</md-dialog>`,
        controller:
        /* @ngInject */
          ($mdDialog, $scope, GoogleDriveSync) => {
            $scope.loadFromRemote = () => {
              $mdDialog.hide();
            };

            $scope.saveToRemote = () => {
              $mdDialog.cancel();
              // we need some time so the promise is canceled
              setTimeout(() => {
                GoogleDriveSync.saveTo();
              }, 100);
            };

            $scope.cancel = () => {
              $mdDialog.cancel();
            };
          },
      });
    }

    _confirmUsingExistingFileDialog(fileName) {
      const confirm = this.$mdDialog.confirm()
        .title(`Use existing file "${fileName}" as sync file?`)
        .textContent(`
        We found a file with the name you specified. Do you want to use it as your sync file? If not please change the Sync file name.`)
        .ok('Please do it!')
        .cancel('Abort');

      return this.$mdDialog.show(confirm);
    }

    _confirmSaveNewFile(fileName) {
      const confirm = this.$mdDialog.confirm()
        .title(`Create "${fileName}" as sync file on Google Drive?`)
        .textContent(`
        No file with the name you specified was found. Do you want to create it?`)
        .ok('Please do it!')
        .cancel('Abort');

      return this.$mdDialog.show(confirm);
    }

    _save() {
      const completeData = this._getLocalAppData();

      return this.GoogleApi.saveFile(completeData, {
        title: this.config.syncFileName,
        id: this.data.backupDocId,
        editable: true
      })
        .then((res) => {
          this.data.backupDocId = res.data.id;
          this.data.lastSyncToRemote = res.data.modifiedDate;
          // also needs to be updated
          this.data.lastLocalUpdate = res.data.modifiedDate;

          // directly save app storage to minify the risk of getting conflicts
          this.AppStorage.saveToLs();
        });
    }

    _load() {
      if (!this.config.syncFileName) {
        return this.$q.reject('No file name specified');
      }

      return this.GoogleApi.loadFile(this.data.backupDocId)
        .then((res) => {
          return this.$q.when(res);
        });
    }

    resetAutoSyncToRemoteInterval() {
      // always unset if set
      this.cancelAutoSyncToRemoteIntervalIfSet();
      if (!this.config.isAutoSyncToRemote || !this.config.isEnabled) {
        return;
      }

      const interval = window.moment.duration(this.config.syncInterval).asMilliseconds();

      if (interval < 5000) {
        this._log('Interval too low');
        return;
      }

      this.autoSyncInterval = this.$interval(() => {
        // only sync if not in the middle of something
        this.saveForSyncIfEnabled();
      }, interval);
    }

    cancelAutoSyncToRemoteIntervalIfSet() {
      if (this.autoSyncInterval) {
        this.$interval.cancel(this.autoSyncInterval);
      }
    }

    changeSyncFileName(newSyncFileName) {
      const defer = this.$q.defer();

      this.GoogleApi.findFile(newSyncFileName)
        .then((res) => {
          const filesFound = res.data.items;
          if (!filesFound || filesFound.length === 0) {
            this._confirmSaveNewFile(newSyncFileName)
              .then(() => {
                this.config.syncFileName = newSyncFileName;
                // we need to unset to save to a new file
                this.data.backupDocId = undefined;
                this._save().then(defer.resolve);
              }, defer.reject);
          } else if (filesFound.length > 1) {
            this.SimpleToast('ERROR', `Multiple files with the name "${newSyncFileName}" found. Please delete all but one or choose a different name.`);
            defer.reject();
          } else if (filesFound.length === 1) {
            this._confirmUsingExistingFileDialog(newSyncFileName)
              .then(() => {
                const fileToUpdate = filesFound[0];
                this.data.backupDocId = fileToUpdate.id;
                this.config.syncFileName = newSyncFileName;
                defer.resolve(this.data.backupDocId);
              }, defer.reject);
          }
        });

      return defer.promise;
    }

    saveForSyncIfEnabled() {
      if (!this.config.isAutoSyncToRemote || !this.config.isEnabled) {
        return this.$q.resolve();
      }

      if (this._isCurrentPromisePending()) {
        this._log('SYNC OMITTED because of promise', this.currentPromise, this.currentPromise.$$state.status);
        return this.$q.reject();
      } else {
        this._log('SYNC');
        const promise = this.saveTo();
        if (this.config.isNotifyOnSync) {
          this._showAsyncToast(promise, 'Syncing to google drive');
        }
        return promise;
      }
    }

    saveTo() {
      // don't execute sync interactions at the same time
      if (this._isCurrentPromisePending()) {
        this._log('saveTo omitted because is in progress', this.currentPromise, this.currentPromise.$$state.status);
        return this.$q.reject('Something in progress');
      }

      const defer = this.$q.defer();
      this.currentPromise = defer.promise;

      // CREATE OR FIND
      // ---------------------------
      // when we have no backup file we create one directly
      if (!this.data.backupDocId) {
        if (!this.config.syncFileName) {
          this.config.syncFileName = DEFAULT_SYNC_FILE_NAME;
        }

        this.changeSyncFileName(this.config.syncFileName)
          .then(() => {
            this._save().then(defer.resolve);
          }, defer.reject);

        // JUST UPDATE
        // ---------------------------
        // otherwise update
      } else {
        this.GoogleApi.getFileInfo(this.data.backupDocId)
          .then((res) => {
            const lastModifiedRemote = res.data.modifiedDate;
            if (this._isNewerThan(lastModifiedRemote, this.data.lastSyncToRemote)) {
              // remote has an update so prompt what to do
              this._confirmSaveDialog(lastModifiedRemote)
                .then(() => {
                  this._save().then(defer.resolve);
                }, defer.reject);
            } else {
              // all clear just save
              this._save().then(defer.resolve);
            }
          })
          .catch(defer.reject);
      }

      return defer.promise;
    }

    loadFrom(isSkipPromiseCheck = false) {
      const defer = this.$q.defer();

      const loadHandler = () => {
        this._load().then((loadRes) => {
          // const lastModifiedRemote = loadRes.meta.modifiedDate;
          const lastActiveLocal = this.$rootScope.r.lastActiveTime;
          const lastActiveRemote = loadRes.backup.lastActiveTime;

          // no update required
          if (this._isEqual(lastActiveLocal, lastActiveRemote)) {
            this._log('date comparision isEqual', lastActiveLocal, lastActiveRemote);
            this.SimpleToast('SUCCESS', `Data already up to date`);
            defer.reject();
          }

          // update but ask if remote data is not newer than the last local update
          else {
            const isSkipConfirm = lastActiveRemote && this._isNewerThan(lastActiveRemote, lastActiveLocal);
            this._log('date comparision skipConfirm', isSkipConfirm, lastActiveLocal, lastActiveRemote);

            if (isSkipConfirm) {
              this._import(loadRes);
              defer.resolve(loadRes);
            } else {
              this._confirmLoadDialog(lastActiveRemote, lastActiveLocal)
                .then(() => {
                  this._import(loadRes);
                  defer.resolve(loadRes);
                }, defer.reject);
            }
          }
        }, defer.reject);
      };

      // don't execute sync interactions at the same time
      if (!isSkipPromiseCheck && this._isCurrentPromisePending()) {
        this._log('loadFrom omitted because is in progress', this.currentPromise, this.currentPromise.$$state.status);
        return this.$q.reject('Something in progress');
      }
      // only assign this after promise check
      this.currentPromise = defer.promise;

      // when we have no backup file we create one directly
      if (!this.data.backupDocId) {
        if (!this.config.syncFileName) {
          this.config.syncFileName = DEFAULT_SYNC_FILE_NAME;
        }
        this.changeSyncFileName(this.config.syncFileName)
          .then(() => {
            loadHandler();
          }, defer.reject);
      } else {
        loadHandler();
      }


      return defer.promise;
    }
  }

  angular
    .module('superProductivity')
    .service('GoogleDriveSync', GoogleDriveSync);

  // hacky fix for ff
  GoogleDriveSync.$$ngIsClass = true;
})();
