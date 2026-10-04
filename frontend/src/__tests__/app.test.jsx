import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db, calls, rpcResults, makeAuth, resetDb, SUMMARY, scanCode } from './testkit.jsx';

const state = vi.hoisted(() => ({ auth: null }));
vi.mock('../lib/supabaseClient', async () => ({ supabase: (await import('./testkit.jsx')).supabaseStub }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => state.auth, AuthProvider: ({ children }) => children }));
vi.mock('react-chartjs-2', () => ({ Bar: () => <div data-testid="chart" /> }));

import Billing from '../pages/Billing';
import Bills from '../pages/Bills';
import Inventory from '../pages/Inventory';
import Items from '../pages/admin/Items';
import Branches from '../pages/admin/Branches';
import Staff from '../pages/admin/Staff';
import Discounts from '../pages/admin/Discounts';
import ActivityLog from '../pages/admin/ActivityLog';
import DangerZone from '../pages/admin/DangerZone';
import DataManager from '../pages/admin/DataManager';
import CustomOrders from '../pages/CustomOrders';
import Production from '../pages/Production';
import Availability from '../pages/Availability';
import Reports from '../pages/Reports';
import Dashboard from '../pages/Dashboard';
import History from '../pages/History';
import RefundModal from '../components/RefundModal';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import ConfirmPasswordModal from '../components/ConfirmPasswordModal';
import BranchRequired from '../components/BranchRequired';

const wrap = (el) => render(<MemoryRouter>{el}</MemoryRouter>);

beforeEach(() => { resetDb(); state.auth = makeAuth(); });

describe('every page renders without crashing', () => {
  const pages = [
    ['Billing', <Billing />, /Billing/],
    ['Bills', <Bills />, /^Bills$/],
    ['Inventory', <Inventory />, /^Inventory$/],
    ['Products', <Items />, /^Products$/],
    ['Branches', <Branches />, /^Branches$/],
    ['Staff & Permissions', <Staff />, /Staff & Permissions/],
    ['Discounts', <Discounts />, /^Discounts$/],
    ['Activity Log', <ActivityLog />, /Activity Log/],
    ['Danger Zone', <DangerZone />, /Danger Zone/],
    ['Import / Export', <DataManager />, /Import \/ Export/],
    ['Custom Orders', <CustomOrders />, /Custom Orders/],
    ['Production', <Production />, /Production Tracking/],
    ['Availability', <Availability />, /Availability/],
    ['Reports', <Reports />, /Sales Reports/],
    ['History', <History />, /^History$/],
  ];
  for (const [name, el, heading] of pages) {
    it(name, async () => {
      wrap(el);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
    });
  }
});

describe('Dashboard', () => {
  it('shows the full P&L with real numbers for someone with financial access', async () => {
    rpcResults.dashboard_summary = SUMMARY;
    wrap(<Dashboard />);
    expect(await screen.findByText('Profit & loss')).toBeTruthy();
    expect(screen.getAllByText(/320\.00/).length).toBeGreaterThan(0);       // net profit
    expect(screen.getAllByText(/1,195\.00/).length).toBeGreaterThan(0);     // cash in hand
    expect(screen.getByText('Expenses & corrections')).toBeTruthy();
    expect(screen.getByTestId('chart')).toBeTruthy();
  });
  it('falls back to the simple sales view when there is no financial permission', async () => {
    state.auth = makeAuth({ isOwner: false, can: (k) => k !== 'reports.financial.view' });
    wrap(<Dashboard />);
    expect(await screen.findByText(/Today's sales/)).toBeTruthy();
    expect(screen.queryByText('Profit & loss')).toBeNull();
  });
});

describe('Products page — scanning', () => {
  it('scanning a known barcode SELECTS that product for editing', async () => {
    wrap(<Items />);
    await screen.findByText('Chocolate Cake');
    act(() => scanCode('CAKE'));
    expect(await screen.findByText(/Selected “Chocolate Cake”/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Edit product' })).toBeTruthy();
    expect(screen.getByDisplayValue('Chocolate Cake')).toBeTruthy();                       // name field filled
    expect(screen.getByPlaceholderText('scan, type, or generate').value).toBe('CAKE');     // SKU field filled
    // the list is narrowed to just that product, so Delete / Discontinue / Label are right there
    expect(screen.queryByText('Vanilla Cupcake')).toBeNull();
  });

  it('scanning an unknown barcode offers to ADD it, and pre-fills the SKU', async () => {
    wrap(<Items />);
    await screen.findByText('Chocolate Cake');
    act(() => scanCode('8901234567890'));
    const addBtn = await screen.findByRole('button', { name: /Add it as a new product/ });
    fireEvent.click(addBtn);
    expect(screen.getByRole('heading', { name: 'New product' })).toBeTruthy();
    expect(screen.getByDisplayValue('8901234567890')).toBeTruthy();
  });

  it('a scanner pressing Enter inside the SKU box does NOT submit the half-filled form', async () => {
    wrap(<Items />);
    await screen.findByText('Chocolate Cake');
    const sku = screen.getByPlaceholderText('scan, type, or generate');
    fireEvent.change(sku, { target: { value: '12345678' } });
    // fireEvent returns false when the handler cancelled the event — i.e. the browser's
    // "Enter submits the form" default is blocked, which is exactly what must happen.
    const notCancelled = fireEvent.keyDown(sku, { key: 'Enter' });
    expect(notCancelled).toBe(false);
    expect(calls.filter((c) => c.table === 'items' && c.op === 'insert')).toHaveLength(0);
    expect(sku.value).toBe('12345678');
  });

  it('refuses a SKU already used by another product, with a clear message', async () => {
    wrap(<Items />);
    await screen.findByText('Chocolate Cake');
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Another Cake' } }); // product name (first textbox is the search box)
    fireEvent.change(screen.getByPlaceholderText('scan, type, or generate'), { target: { value: 'cake' } }); // same as CAKE, different case
    fireEvent.change(document.querySelector('input[type="number"][required]'), { target: { value: '450' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    expect(await screen.findByText(/already belongs to “Chocolate Cake”/)).toBeTruthy();
    expect(calls.filter((c) => c.table === 'items' && c.op === 'insert')).toHaveLength(0);
  });

  it('typing a code in the find box and pressing Enter selects the product too', async () => {
    wrap(<Items />);
    await screen.findByText('Vanilla Cupcake');
    const box = screen.getByPlaceholderText(/Search by name, SKU or category/);
    fireEvent.change(box, { target: { value: 'CUP' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText(/Selected “Vanilla Cupcake”/)).toBeTruthy();
  });

  it('typing slowly (a person, not a scanner) is NOT mistaken for a scan', async () => {
    wrap(<Items />);
    await screen.findByText('Chocolate Cake');
    let t = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (t += 400)); // 400ms between keys
    act(() => scanCode('CAKE'));
    spy.mockRestore();
    expect(screen.queryByText(/Selected “Chocolate Cake”/)).toBeNull();
  });
});

describe('Billing — scanning', () => {
  it('a scan with nothing focused adds the product to the bill', async () => {
    wrap(<Billing />);
    await screen.findByText('Chocolate Cake');
    act(() => scanCode('CAKE'));
    await waitFor(() => expect(screen.getAllByText('Chocolate Cake').length).toBeGreaterThan(1)); // grid + cart line
  });

  it('scanning the same item again increases its quantity (does not add a second line)', async () => {
    wrap(<Billing />);
    await screen.findByText('Chocolate Cake');
    act(() => scanCode('CAKE'));
    act(() => scanCode('CAKE'));
    await waitFor(() => expect(document.body.textContent).toMatch(/× ?Rs500\.00/));
    expect(screen.getAllByText('Chocolate Cake').length).toBe(2); // grid button + exactly ONE cart line
  });

  it('an unknown barcode gives a clear message instead of silently doing nothing', async () => {
    wrap(<Billing />);
    await screen.findByText('Chocolate Cake');
    act(() => scanCode('NOPE-123'));
    expect(await screen.findByText(/No product found with SKU\/barcode "NOPE-123"/)).toBeTruthy();
  });

  it('a cashier (bills.create only) can see stock and bill — the earlier "everything out of stock" bug', async () => {
    state.auth = makeAuth({ isOwner: false, can: (k) => k === 'bills.create' });
    wrap(<Billing />);
    await screen.findByText('Chocolate Cake');
    expect(screen.queryAllByText(/Out of stock/i).length).toBe(0);
  });
});

describe('Inventory — scanning', () => {
  it('scanning a barcode filters to that product and focuses its quantity box', async () => {
    wrap(<Inventory />);
    await screen.findByText(/Chocolate Cake/);
    act(() => scanCode('CUP'));
    await waitFor(() => expect(screen.queryByText(/Chocolate Cake/)).toBeNull());
    expect(screen.getByText(/Vanilla Cupcake/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-amount')).toBe(true));
  });
  it('consolidated view shows the branch NAME, not a piece of an id', async () => {
    wrap(<Inventory />);
    await screen.findByText(/Chocolate Cake/);
    fireEvent.click(screen.getByLabelText(/Show consolidated/));
    await waitFor(() => expect(screen.getAllByText('Lahore').length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toMatch(/b1…/);
  });
});

describe('Camera scanner modal', () => {
  it('explains plainly when the page is not secure instead of failing silently', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    wrap(<BarcodeScannerModal onDetected={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/only works on a secure page/)).toBeTruthy();
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });
  it('always offers typing the code as a fallback, and that works', async () => {
    const onDetected = vi.fn();
    wrap(<BarcodeScannerModal onDetected={onDetected} onClose={() => {}} />);
    const box = await screen.findByPlaceholderText('Or type the code here');
    fireEvent.change(box, { target: { value: 'CAKE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(onDetected).toHaveBeenCalledWith('CAKE');
  });
});

describe('Refund / return / exchange modal', () => {
  const bill = { id: 'inv1', invoice_number: 'LHR-000001', status: 'completed', subtotal: 1000, total_amount: 990, branch_id: 'b1', currency_symbol: 'Rs' };
  beforeEach(() => {
    db.invoice_items = [{ id: 'l1', invoice_id: 'inv1', item_id: 'i1', item_name: 'Chocolate Cake', quantity: 2, unit_price: 500, line_total: 1000 }];
    db.refunds = []; db.refund_items = [];
  });
  it('shows the three modes and works out a tax/discount-proportional refund', async () => {
    wrap(<RefundModal bill={bill} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText('Return item(s)')).toBeTruthy();
    expect(screen.getByText('Money only')).toBeTruthy();
    expect(screen.getByText('Replace / exchange')).toBeTruthy();
    fireEvent.change(await screen.findByRole('spinbutton'), { target: { value: '1' } });
    expect(await screen.findByText(/495\.00/)).toBeTruthy(); // 500 x (990 / 1000)
  });
  it('blocks submitting a return with nothing selected', async () => {
    wrap(<RefundModal bill={bill} onClose={() => {}} onDone={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm return' }));
    expect(await screen.findByText(/Choose at least one item/)).toBeTruthy();
  });
});

describe('password-protected destructive actions', () => {
  it('the confirm modal refuses an empty password and shows server errors inline', async () => {
    const onConfirm = vi.fn().mockResolvedValue('Incorrect password.');
    wrap(<ConfirmPasswordModal title="Delete?" message="m" onConfirm={onConfirm} onClose={() => {}} />);
    // empty password: the browser's own "required" check stops the form before onConfirm is ever called
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(document.querySelector('input[autocomplete="current-password"]'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Incorrect password.')).toBeTruthy();
  });
  it('Danger Zone: the reset button stays locked until the exact phrase is typed', async () => {
    wrap(<DangerZone />);
    const btn = await screen.findByRole('button', { name: /Reset everything/ });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('DELETE ALL DATA'), { target: { value: 'delete all data' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('DELETE ALL DATA'), { target: { value: 'DELETE ALL DATA' } });
    expect(btn.disabled).toBe(false);
  });
  it('Danger Zone is closed to anyone who is not the Owner', async () => {
    state.auth = makeAuth({ isOwner: false });
    wrap(<DangerZone />);
    expect(await screen.findByText(/Only the Owner/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reset everything/ })).toBeNull();
  });
});

describe('no-branch state (e.g. right after a full reset)', () => {
  it('explains what to do instead of showing broken empty pages', async () => {
    state.auth = makeAuth({ branches: [], currentBranchId: null });
    wrap(<BranchRequired><Billing /></BranchRequired>);
    expect(await screen.findByText(/No branch to work in yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Admin → Branches/ })).toBeTruthy();
  });
});

import { sameCode, normalizeCode } from '../lib/scanning';

describe('barcode matching (sameCode)', () => {
  it('ignores case and stray spaces', () => {
    expect(sameCode('CAKE', ' cake ')).toBe(true);
  });
  it('treats a 12-digit UPC-A and its 13-digit EAN-13 form as the same product', () => {
    expect(sameCode('036000291452', '0036000291452')).toBe(true);
  });
  it('keeps different products different', () => {
    expect(sameCode('5901234123457', '5901234123458')).toBe(false);
    expect(sameCode('BK-007', 'BK-7')).toBe(false);     // not all digits → compared as written
    expect(sameCode('', 'CAKE')).toBe(false);
    expect(normalizeCode(null)).toBe('');
  });
});

describe('scanner finds a product despite the UPC/EAN leading-zero difference', () => {
  it('Billing adds a product whose SKU is stored as UPC-A when the scanner sends EAN-13', async () => {
    db.items[0].sku = '036000291452';
    wrap(<Billing />);
    await screen.findByText('Chocolate Cake');
    act(() => scanCode('0036000291452'));
    await waitFor(() => expect(screen.getAllByText('Chocolate Cake').length).toBeGreaterThan(1));
  });
});
