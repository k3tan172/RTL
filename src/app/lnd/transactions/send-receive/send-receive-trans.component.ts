import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';

import { SelNodeChild } from '../../../shared/models/RTLconfig';
import { GetInfo, Balance, ChannelsTransaction, AddressType } from '../../../shared/models/lndModels';
import { RTLConfiguration } from '../../../shared/models/RTLconfig';
import { LoggerService } from '../../../shared/services/logger.service';
import * as sha256 from 'sha256';

import { LNDEffects } from '../../store/lnd.effects';
import { RTLEffects } from '../../../store/rtl.effects';
import * as RTLActions from '../../../store/rtl.actions';
import * as fromRTLReducer from '../../../store/rtl.reducers';

@Component({
  selector: 'rtl-send-receive-trans',
  templateUrl: './send-receive-trans.component.html',
  styleUrls: ['./send-receive-trans.component.scss']
})
export class SendReceiveTransComponent implements OnInit, OnDestroy {
  public selNode: SelNodeChild = {};
  public appConfig: RTLConfiguration;
  public addressTypes = [];
  public flgLoadingWallet: Boolean | 'error' = true;
  public selectedAddress: AddressType = {};
  public blockchainBalance: Balance = {};
  public information: GetInfo = {};
  public newAddress = '';
  public transaction: ChannelsTransaction = {};
  public transTypes = [{id: '1', name: 'Target Confirmation Blocks'}, {id: '2', name: 'Fee'}];
  public selTransType = '1';
  public flgCustomAmount = '1';
  private unsub: Array<Subject<void>> = [new Subject(), new Subject(), new Subject(), new Subject(), new Subject()];

  constructor(private logger: LoggerService, private store: Store<fromRTLReducer.RTLState>, private rtlEffects: RTLEffects, private lndEffects: LNDEffects) {}

  ngOnInit() {
    this.store.select('root')
    .pipe(takeUntil(this.unsub[0]))
    .subscribe((rootStore) => {
      this.appConfig = rootStore.appConfig;
      this.logger.info(rootStore);
    });

    this.store.select('lnd')
    .pipe(takeUntil(this.unsub[0]))
    .subscribe((rtlStore) => {
      rtlStore.effectErrorsLnd.forEach(effectsErr => {
        if (effectsErr.action === 'FetchBalance/blockchain') {
          this.flgLoadingWallet = 'error';
        }
      });
      this.selNode = rtlStore.nodeSettings;
      this.information = rtlStore.information;
      this.addressTypes = rtlStore.addressTypes;

      this.blockchainBalance = rtlStore.blockchainBalance;
      if (undefined === this.blockchainBalance.total_balance) {
        this.blockchainBalance.total_balance = '0';
      }
      if (undefined === this.blockchainBalance.confirmed_balance) {
        this.blockchainBalance.confirmed_balance =  '0';
      }
      if (undefined === this.blockchainBalance.unconfirmed_balance) {
        this.blockchainBalance.unconfirmed_balance =  '0';
      }
      if (this.flgLoadingWallet !== 'error') {
        this.flgLoadingWallet = false;
      }

      this.logger.info(rtlStore);
    });

  }

  onGenerateAddress() {
    this.store.dispatch(new RTLActions.OpenSpinner('Getting New Address...'));
    this.store.dispatch(new RTLActions.GetNewAddress(this.selectedAddress));
    this.lndEffects.setNewAddress
    .pipe(takeUntil(this.unsub[1]))
    .subscribe(newAddress => {
      this.newAddress = newAddress;
    });
  }

  onSendFunds() {
    const confirmationMsg = {
      'BTC Address': this.transaction.address,
    };
    if (!+this.flgCustomAmount) {
      confirmationMsg['Sweep All'] = 'True';
      this.transaction.sendAll = true;
    } else {
      confirmationMsg['Amount (' + this.information.smaller_currency_unit + ')'] = this.transaction.amount;
      this.transaction.sendAll = false;
    }
    if (this.selTransType === '1') {
      delete this.transaction.fees;
      confirmationMsg['Target Confirmation Blocks'] = this.transaction.blocks;
    } else {
      delete this.transaction.blocks;
      confirmationMsg['Fee (' + this.information.smaller_currency_unit + '/Byte)'] = this.transaction.fees;
    }
    this.store.dispatch(new RTLActions.OpenConfirmation({ width: '70%', data:
      {type: 'CONFIRM', message: JSON.stringify(confirmationMsg), noBtnText: 'Cancel', yesBtnText: 'Send'}
    }));

    this.rtlEffects.closeConfirm
    .pipe(takeUntil(this.unsub[2]))
    .subscribe(confirmRes => {
      if (confirmRes) {
        if (this.transaction.sendAll && !+this.appConfig.sso.rtlSSO) {
          this.store.dispatch(new RTLActions.OpenConfirmation({ width: '70%', data:
            {type: 'CONFIRM', titleMessage: 'Enter Login Password', noBtnText: 'Cancel', yesBtnText: 'Authorize', flgShowInput: true, getInputs: [
              {placeholder: 'Enter Login Password', inputType: 'password', inputValue: ''}
            ]}
          }));
          this.rtlEffects.closeConfirm
          .pipe(takeUntil(this.unsub[3]))
          .subscribe(pwdConfirmRes => {
            if (pwdConfirmRes) {
              const pwd = pwdConfirmRes[0].inputValue;
              this.store.dispatch(new RTLActions.IsAuthorized(sha256(pwd)));
              this.rtlEffects.isAuthorizedRes
              .pipe(take(1))
              .subscribe(authRes => {
                if (authRes !== 'ERROR') {
                  this.dispatchToSendFunds();
                }
              });
            }
          });
        } else {
          this.dispatchToSendFunds();
        }
      }
    });
  }

  dispatchToSendFunds() {
    this.store.dispatch(new RTLActions.OpenSpinner('Sending Funds...'));
    this.store.dispatch(new RTLActions.SetChannelTransaction(this.transaction));
    this.transaction = {address: '', amount: 0, blocks: 0, fees: 0};
  }

  get invalidValues(): boolean {
    return (undefined === this.transaction.address || this.transaction.address === '')
        || (+this.flgCustomAmount && (undefined === this.transaction.amount || this.transaction.amount <= 0))
        || (this.selTransType === '1' && (undefined === this.transaction.blocks || this.transaction.blocks <= 0))
        || (this.selTransType === '2' && (undefined === this.transaction.fees || this.transaction.fees <= 0));
  }

  onCustomClicked() {
    this.flgCustomAmount = '1';
  }

  onOptionChange(event) {
    if (!+this.flgCustomAmount) {
      delete this.transaction.amount;
    }
  }

  resetData() {
    this.transaction.address = '';
    this.transaction.amount = 0;
    this.transaction.blocks = 0;
    this.transaction.fees = 0;
  }

  resetReceiveData() {
    this.selectedAddress = {};
    this.newAddress = '';
  }

  ngOnDestroy() {
    this.unsub.forEach(completeSub => {
      completeSub.next();
      completeSub.complete();
    });
  }
}
