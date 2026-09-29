import 'saved_drafts.dart';
import 'dart:async';
import 'kyc_capture.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'dashboard_charts.dart';

import 'services.dart';
import 'experience.dart';

const burgundy = RelayPalette.brand,
    ink = RelayPalette.ink,
    muted = Color(0xFF526079),
    green = RelayPalette.teal;
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: RelayApp()));
}

final router = GoRouter(
  routes: [
    GoRoute(path: '/', builder: (c, s) => const Gate()),
    GoRoute(path: '/drafts', builder: (c, s) => const SavedDraftsScreen()),
    GoRoute(path: '/ekyc', builder: (c, s) => const KycCaptureScreen()),
    GoRoute(
      path: '/transactions',
      builder: (c, s) =>
          TransactionsScreen(view: s.uri.queryParameters['view'] ?? 'all'),
    ),
    GoRoute(
      path: '/transaction/:id',
      builder: (c, s) => KycCaptureScreen(captureId: s.pathParameters['id']),
    ),
    GoRoute(
      path: '/stock',
      builder: (c, s) => Scaffold(
        appBar: AppBar(
          leading: const WorkspaceBackButton(),
          title: const Text('Inventory'),
        ),
        body: const StockScreen(),
      ),
    ),
    GoRoute(
      path: '/screenshot-capture',
      builder: (c, s) => KycCaptureScreen(
        initial: s.extra is Map
            ? Map<String, dynamic>.from(s.extra as Map)
            : const {},
      ),
    ),
    GoRoute(
      path: '/records',
      builder: (c, s) => Scaffold(
        appBar: AppBar(
          leading: const WorkspaceBackButton(),
          title: const Text('Sales records'),
        ),
        body: const OrdersScreen(),
      ),
    ),
    GoRoute(
      path: '/incentives',
      builder: (c, s) => Scaffold(
        appBar: AppBar(
          leading: const WorkspaceBackButton(),
          title: const Text('My incentives'),
        ),
        body: const IncentivesScreen(),
      ),
    ),
    GoRoute(
      path: '/customers',
      builder: (c, s) => Scaffold(
        appBar: AppBar(
          leading: const WorkspaceBackButton(),
          title: const Text('Customers'),
        ),
        body: const CustomersScreen(),
      ),
    ),
    GoRoute(
      path: '/support',
      builder: (c, s) => Scaffold(
        appBar: AppBar(
          leading: const WorkspaceBackButton(),
          title: const Text('Support'),
        ),
        body: const SupportScreen(),
      ),
    ),
    GoRoute(
      path: '/reports',
      builder: (c, s) => Scaffold(
        appBar: AppBar(
          leading: const WorkspaceBackButton(),
          title: const Text('Daily report'),
        ),
        body: const DailyReportScreen(),
      ),
    ),
  ],
);

class RelayApp extends StatelessWidget {
  const RelayApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: 'Relay Client',
    debugShowCheckedModeBanner: false,
    routerConfig: router,
    theme: ThemeData(
      useMaterial3: true,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: RelayPageTransitions(),
          TargetPlatform.iOS: RelayPageTransitions(),
          TargetPlatform.windows: RelayPageTransitions(),
          TargetPlatform.macOS: RelayPageTransitions(),
          TargetPlatform.linux: RelayPageTransitions(),
        },
      ),
      navigationBarTheme: NavigationBarThemeData(
        indicatorColor: const Color(0xFFE8D8FF),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontFamily: 'DM Sans',
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w800
                : FontWeight.w500,
            color: states.contains(WidgetState.selected)
                ? const Color(0xFF642BA6)
                : muted,
          ),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: const Color(0xFF293B58),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      fontFamily: 'DM Sans',
      colorScheme: ColorScheme.fromSeed(
        seedColor: burgundy,
        primary: burgundy,
        surface: Colors.white,
      ),
      scaffoldBackgroundColor: RelayPalette.canvas,
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFFF6EEF6),
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          fontFamily: 'Manrope',
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: ink,
        ),
        foregroundColor: ink,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        color: Colors.white,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: Color(0xFFDCDDEC)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.all(16),
        hintStyle: const TextStyle(color: Color(0xFF67758C), fontSize: 14),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFFD6DEEF)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: burgundy, width: 1.6),
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFFE2E5EB)),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 48),
          foregroundColor: burgundy,
          side: const BorderSide(color: Color(0xFFD8C5CE)),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(11),
          ),
        ),
      ),
    ),
  );
}

class Gate extends ConsumerStatefulWidget {
  const Gate({super.key});
  @override
  ConsumerState<Gate> createState() => _GateState();
}

class _GateState extends ConsumerState<Gate> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(serviceProvider).initialize());
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(serviceProvider);
    if (!s.ready) return const Scaffold(body: LoadingCards());
    return s.user == null ? const LoginScreen() : const FieldShell();
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginState();
}

class _LoginState extends ConsumerState<LoginScreen> {
  final email = TextEditingController(text: 'agent1@relay.demo'),
      password = TextEditingController();
  bool busy = false;
  String? error;
  @override
  void dispose() {
    email.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 430),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.sensors, size: 38, color: burgundy),
                    SizedBox(width: 10),
                    Text(
                      'relay.',
                      style: TextStyle(
                        fontSize: 36,
                        fontWeight: FontWeight.w800,
                        color: burgundy,
                        letterSpacing: -2,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 45),
                const Text(
                  'Your next connection\nstarts here.',
                  style: TextStyle(
                    fontSize: 29,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -1,
                    height: 1.25,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  'Sign in to your field workspace.',
                  style: TextStyle(color: muted),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Work email'),
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: password,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Password'),
                ),
                const SizedBox(height: 22),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      error!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ),
                FilledButton(
                  onPressed: busy
                      ? null
                      : () async {
                          setState(() => busy = true);
                          try {
                            await ref
                                .read(serviceProvider)
                                .login(email.text.trim(), password.text);
                          } catch (e) {
                            if (mounted) {
                              setState(() => error = friendlyError(e));
                            }
                          } finally {
                            if (mounted) setState(() => busy = false);
                          }
                        },
                  child: Text(busy ? 'Signing in…' : 'Sign in to Relay'),
                ),
                const SizedBox(height: 28),
                const InfoCard(
                  icon: Icons.shield_outlined,
                  text: 'Capture transactions and follow their progress.',
                ),
                const SizedBox(height: 15),
                const Text(
                  'FIELD OPERATIONS / UAE',
                  style: TextStyle(
                    fontSize: 10,
                    letterSpacing: 2,
                    color: muted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class FieldShell extends ConsumerStatefulWidget {
  const FieldShell({super.key});
  @override
  ConsumerState<FieldShell> createState() => _FieldShellState();
}

class _FieldShellState extends ConsumerState<FieldShell>
    with WidgetsBindingObserver {
  int tab = 0;
  final visitedTabs = <int>{0};
  bool foreground = true;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    foreground = state == AppLifecycleState.resumed;
    if (foreground) ref.read(serviceProvider).sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(serviceProvider);
    return PopScope(
      canPop: tab == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && tab != 0) setState(() => tab = 0);
      },
      child: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              if (!s.online || s.queued > 0)
                Container(
                  width: double.infinity,
                  color: const Color(0xFFFFF2DC),
                  padding: const EdgeInsets.all(10),
                  child: Text(
                    '${s.online ? 'SYNC PENDING' : 'OFFLINE'} · ${s.queued} queued operation(s)',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF9F7527),
                    ),
                  ),
                ),
              Expanded(
                child: IndexedStack(
                  index: tab,
                  children: List.generate(5, (i) {
                    if (!visitedTabs.contains(i)) {
                      return const SizedBox.shrink();
                    }
                    return TickerMode(
                      enabled: tab == i,
                      child: AnimatedOpacity(
                        opacity: tab == i ? 1 : 0,
                        duration: motionDuration(context),
                        child: [
                          s.user?['role'] == 'Team Leader'
                              ? const LeaderConfirmationsScreen()
                              : const HomeScreen(),
                          const SizedBox.shrink(),
                          const OrdersScreen(),
                          const StockScreen(),
                          const ProfileScreen(),
                        ][i],
                      ),
                    );
                  }),
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: NavigationBar(
          height: 72,
          backgroundColor: Colors.white,
          indicatorColor: const Color(0xFFE4D3FF),
          selectedIndex: tab,
          onDestinationSelected: (i) {
            if (i == 1) {
              ScaffoldMessenger.of(context).removeCurrentSnackBar();
              context.push(
                s.user?['role'] == 'Team Leader' ? '/transactions' : '/ekyc',
              );
            } else {
              setState(() {
                tab = i;
                visitedTabs.add(i);
              });
            }
          },
          destinations: [
            NavigationDestination(
              icon: Icon(Icons.grid_view_outlined, color: RelayPalette.plum),
              selectedIcon: Icon(
                Icons.grid_view_rounded,
                color: RelayPalette.plum,
              ),
              label: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.add_circle_outline, color: RelayPalette.brand),
              label: s.user?['role'] == 'Team Leader'
                  ? 'History'
                  : 'Capture',
            ),
            NavigationDestination(
              icon: Icon(Icons.receipt_long_outlined, color: Color(0xFF98610F)),
              selectedIcon: Icon(Icons.receipt_long, color: Color(0xFF98610F)),
              label: 'Orders',
            ),
            NavigationDestination(
              icon: Icon(Icons.sim_card_outlined, color: RelayPalette.teal),
              selectedIcon: Icon(Icons.sim_card, color: RelayPalette.teal),
              label: 'Stock',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline, color: Color(0xFF426FB6)),
              selectedIcon: Icon(Icons.person, color: Color(0xFF426FB6)),
              label: 'Profile',
            ),
          ],
        ),
      ),
    );
  }
}

class LeaderConfirmationsScreen extends ConsumerStatefulWidget {
  const LeaderConfirmationsScreen({super.key});
  @override
  ConsumerState<LeaderConfirmationsScreen> createState() =>
      _LeaderConfirmationsState();
}

class _LeaderConfirmationsState
    extends ConsumerState<LeaderConfirmationsScreen> {
  List<Json> rows = [];
  bool busy = true;
  String? error;
  Timer? refreshTimer;
  @override
  void initState() {
    super.initState();
    load();
    refreshTimer = Timer.periodic(const Duration(seconds: 10), (_) => load());
  }

  Future<void> load() async {
    try {
      final r = await ref
          .read(serviceProvider)
          .dio
          .get('/kyc-captures/leader-confirmations');
      if (mounted) {
        setState(() {
          rows = (r.data as List)
              .map((r) => Map<String, dynamic>.from(r))
              .toList();
          busy = false;
          error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          error = friendlyError(e);
          busy = false;
        });
      }
    }
  }

  @override
  void dispose() {
    refreshTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: load,
    child: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'Branch updates',
          style: TextStyle(fontSize: 23, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        if (busy) const LinearProgressIndicator(),
        if (error != null)
          Text(error!, style: const TextStyle(color: Colors.red)),
        if (!busy && rows.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(18),
              child: Text('No backend confirmations yet'),
            ),
          ),
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Transaction confirmed by backend',
                      style: TextStyle(
                        color: green,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${row['intake']?['name'] ?? 'Customer'}',
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      '${row['source_reference']} · ${row['intake']?['plan_name'] ?? 'Not recorded'}',
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton(
                      onPressed: () => context.push('/transaction/${row['id']}'),
                      child: const Text('View details'),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    ),
  );
}

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(dashboardProvider), s = ref.watch(serviceProvider);
    return data.when(
      loading: () => const LoadingCards(),
      error: (e, st) =>
          RetryView(error: e, onRetry: () => ref.invalidate(dashboardProvider)),
      data: (d) {
        final agents = (d['agents'] as List).cast<Json>(),
            a = agents.isEmpty ? <String, dynamic>{} : agents.first;
        final onShift = a['on_shift'] == true;
        return RefreshIndicator(
          onRefresh: () async {
            await s.sync();
            ref.invalidate(dashboardProvider);
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 26),
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'relay.',
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      color: burgundy,
                      letterSpacing: -1.5,
                    ),
                  ),
                  StatusPill(onShift ? 'ACTIVE SHIFT' : 'OFF SHIFT'),
                ],
              ),
              const SizedBox(height: 18),
              Text(
                'Good ${DateTime.now().hour < 12 ? 'morning' : 'afternoon'},',
                style: const TextStyle(color: muted),
              ),
              const SizedBox(height: 5),
              Text(
                '${s.user!['name'].split(' ').first}. Let’s connect.',
                style: const TextStyle(
                  fontSize: 25,
                  fontFamily: 'Manrope',
                  fontWeight: FontWeight.w800,
                  letterSpacing: -.8,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                '${a['employee_id'] ?? 'Operations'} · ${a['outlet'] ?? 'All outlets'}',
                style: const TextStyle(fontSize: 13, color: muted),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(19),
                decoration: BoxDecoration(
                  gradient: RelayPalette.hero,
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x208B2452),
                      blurRadius: 22,
                      offset: Offset(0, 8),
                    ),
                  ],
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(
                          Icons.document_scanner_outlined,
                          color: Color(0xFF83E4BE),
                          size: 20,
                        ),
                        SizedBox(width: 8),
                        Text(
                          'NEXT TRANSACTION',
                          style: TextStyle(
                            color: Color(0xFFCEF2E0),
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'New transaction',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton.icon(
                      onPressed: () {
                        ScaffoldMessenger.of(context).removeCurrentSnackBar();
                        context.push('/ekyc');
                      },
                      style: FilledButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: burgundy,
                      ),
                      icon: const Icon(Icons.add_circle_outline),
                      label: const Text(
                        'Start transaction',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Material(
                color: const Color(0xFFEBF1FE),
                borderRadius: BorderRadius.circular(12),
                child: InkWell(
                  onTap: () => context.push('/stock'),
                  borderRadius: BorderRadius.circular(12),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.account_tree_outlined,
                          size: 20,
                          color: Color(0xFF4783CA),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${a['branch'] ?? 'Assigned branch'}',
                                style: const TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Text(
                                '${a['stock'] ?? 0} SIMs available',
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Icon(
                          Icons.chevron_right,
                          color: Color(0xFF4783CA),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              const SectionTitle('Your day, at a glance'),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: MetricTile(
                      'Activations',
                      d['today'].toString(),
                      Icons.bolt_outlined,
                      onTap: () => context.push('/records'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: MetricTile(
                      'Daily target',
                      d['target'].toString(),
                      Icons.flag_outlined,
                      onTap: () => context.push('/reports'),
                      accent: const Color(0xFFB47721),
                    ),
                  ),
                ],
              ),
              if ((d['kyc_pending_review'] as num) > 0) ...[
                const SizedBox(height: 10),
                Material(
                  color: const Color(0xFFFFF3DF),
                  borderRadius: BorderRadius.circular(10),
                  child: InkWell(
                    onTap: () => context.push('/transactions?view=awaiting'),
                    borderRadius: BorderRadius.circular(10),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 13,
                        vertical: 10,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${d['kyc_pending_review']} ${d['kyc_pending_review'] == 1 ? 'transaction' : 'transactions'} awaiting review',
                              style: const TextStyle(
                                color: Color(0xFF855416),
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const Icon(
                            Icons.chevron_right,
                            color: Color(0xFF855416),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: MetricTile(
                      'Transactions today',
                      '${d['kyc_today']}',
                      Icons.document_scanner_outlined,
                      onTap: () => context.push('/transactions?view=today'),
                      accent: green,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: MetricTile(
                      'Awaiting verification',
                      '${d['kyc_pending_review']}',
                      Icons.fact_check_outlined,
                      onTap: () => context.push('/transactions?view=awaiting'),
                      accent: const Color(0xFF35699C),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Card(
                child: InkWell(
                  onTap: () => context.push('/reports'),
                  borderRadius: BorderRadius.circular(16),
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Expanded(
                              child: Text(
                                'Target achievement',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: muted,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            Text(
                              '${d['achievement']}%',
                              style: const TextStyle(
                                color: burgundy,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            IconButton(
                              tooltip: 'View daily report',
                              onPressed: () => context.push('/reports'),
                              icon: const Icon(Icons.chevron_right),
                            ),
                          ],
                        ),
                        const SizedBox(height: 13),
                        LinearProgressIndicator(
                          value: ((d['achievement'] as num) / 100).clamp(
                            0.0,
                            1.0,
                          ),
                          minHeight: 8,
                          borderRadius: BorderRadius.circular(4),
                          backgroundColor: const Color(0xFFF2E8EE),
                        ),
                        const SizedBox(height: 17),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              '${d['aht']} min handling',
                              style: const TextStyle(
                                fontSize: 13,
                                color: muted,
                              ),
                            ),
                            Text(
                              '${d['ekyc']}% eKYC pass',
                              style: const TextStyle(
                                fontSize: 13,
                                color: green,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              WeeklyActivityCard(d),
              const SizedBox(height: 14),
              VerificationCard(d),
              const SizedBox(height: 22),
              const SectionTitle('Quick actions'),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => context.push('/customers'),
                      icon: const Icon(Icons.person_search_outlined),
                      label: const Text('Customers'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => context.push('/reports'),
                      icon: const Icon(Icons.bar_chart_outlined),
                      label: const Text('Daily report'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => context.push('/records'),
                      icon: const Icon(Icons.receipt_long_outlined),
                      label: const Text('Sales records'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => context.push('/incentives'),
                      icon: const Icon(Icons.payments_outlined),
                      label: const Text('Incentives'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                onPressed: () => context.push('/support'),
                icon: const Icon(Icons.support_agent_outlined),
                label: const Text('Need field support?'),
              ),
              const SizedBox(height: 25),
              const SectionTitle('Latest connections'),
              const SizedBox(height: 12),
              ...(d['recent'] as List)
                  .take(3)
                  .map((o) => OrderCard(Map<String, dynamic>.from(o))),
              const SizedBox(height: 18),
            ],
          ),
        );
      },
    );
  }
}

class TransactionsScreen extends ConsumerStatefulWidget {
  final String view;
  const TransactionsScreen({super.key, this.view = 'all'});

  @override
  ConsumerState<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends ConsumerState<TransactionsScreen> {
  late String view;
  late Future<List<Json>> history;

  @override
  void initState() {
    super.initState();
    view = {'all', 'today', 'awaiting'}.contains(widget.view)
        ? widget.view
        : 'all';
    history = load();
  }

  Future<List<Json>> load() async {
    final result = await ref.read(serviceProvider).dio.get('/kyc-captures');
    return (result.data as List)
        .map((row) => Map<String, dynamic>.from(row))
        .toList();
  }

  Future<void> refresh() async {
    final next = load();
    setState(() => history = next);
    await next;
  }

  bool createdToday(Json row) {
    final raw = row['created_at']?.toString() ?? '';
    final dated = DateTime.tryParse(
      raw.endsWith('Z') || RegExp(r'[+-]\d\d:\d\d$').hasMatch(raw)
          ? raw
          : '${raw}Z',
    );
    if (dated == null) return false;
    final day = dated.toUtc().add(const Duration(hours: 4));
    final today = DateTime.now().toUtc().add(const Duration(hours: 4));
    return day.year == today.year &&
        day.month == today.month &&
        day.day == today.day;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      leading: const WorkspaceBackButton(),
      title: const Text('Transactions'),
    ),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final option in const [
                  ('all', 'All'),
                  ('today', 'Today'),
                  ('awaiting', 'Awaiting review'),
                ])
                  ChoiceChip(
                    label: Text(option.$2),
                    selected: view == option.$1,
                    onSelected: (_) => setState(() => view = option.$1),
                  ),
              ],
            ),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<Json>>(
            future: history,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const LoadingCards();
              }
              if (snapshot.hasError) {
                return RetryView(error: snapshot.error!, onRetry: refresh);
              }
              final rows = (snapshot.data ?? [])
                  .where(
                    (row) =>
                        view == 'all' ||
                        (view == 'today' && createdToday(row)) ||
                        (view == 'awaiting' && row['status'] == 'SUBMITTED'),
                  )
                  .toList();
              return RefreshIndicator(
                onRefresh: refresh,
                child: ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                  children: rows.isEmpty
                      ? [
                          const SizedBox(height: 120),
                          EmptyView(
                            view == 'awaiting'
                                ? 'No transactions awaiting review'
                                : view == 'today'
                                ? 'No transactions today'
                                : 'No transactions yet',
                          ),
                        ]
                      : rows.map((row) {
                          final status = row['status']?.toString() ?? 'PENDING';
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Card(
                              child: InkWell(
                                borderRadius: BorderRadius.circular(16),
                                onTap: () => context.push(
                                  '/transaction/${Uri.encodeComponent(row['id'].toString())}',
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: Row(
                                    children: [
                                      const Icon(
                                        Icons.receipt_long_outlined,
                                        color: burgundy,
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              row['source_reference']
                                                      ?.toString() ??
                                                  'Transaction',
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                            const SizedBox(height: 3),
                                            Text(
                                              row['document_kind'] ==
                                                      'PAYMENT_CONFIRMATION'
                                                  ? 'Payment confirmation'
                                                  : 'Captured transaction',
                                              style: const TextStyle(
                                                color: muted,
                                                fontSize: 13,
                                              ),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              status == 'SUBMITTED'
                                                  ? 'Awaiting review'
                                                  : status == 'VERIFIED'
                                                  ? 'Verified'
                                                  : status == 'REJECTED'
                                                  ? 'Needs correction'
                                                  : status.replaceAll('_', ' '),
                                              style: const TextStyle(
                                                color: burgundy,
                                                fontSize: 12,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      const Icon(
                                        Icons.chevron_right,
                                        color: muted,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          );
                        }).toList(),
                ),
              );
            },
          ),
        ),
      ],
    ),
  );
}

class IncentivesScreen extends ConsumerWidget {
  const IncentivesScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(incentiveProvider);
    return data.when(
      loading: () => const LoadingCards(),
      error: (e, st) =>
          RetryView(error: e, onRetry: () => ref.invalidate(incentiveProvider)),
      data: (rows) => RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(incentiveProvider);
          await ref.read(incentiveProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.all(22),
          children: [
            Text(
              'AED ${rows.fold<double>(0, (sum, row) => sum + (double.tryParse(row['amount'].toString()) ?? 0)).toStringAsFixed(2)}',
              style: const TextStyle(
                fontSize: 30,
                fontWeight: FontWeight.bold,
                color: burgundy,
              ),
            ),
            const Text(
              'Your recorded incentives',
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: 20),
            if (rows.isEmpty) const EmptyView('No incentive entries yet'),
            ...rows.map(
              (item) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Card(
                  child: ListTile(
                    title: Text(
                      'AED ${item['amount']}',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    subtitle: Text('${item['period']} · ${item['source']}'),
                    trailing: const Icon(Icons.chevron_right, color: green),
                    onTap: () =>
                        showRecordDetails(context, 'Incentive details', {
                          'Period': item['period'],
                          'Amount': 'AED ${item['amount']}',
                          'Source': item['source'],
                          'Note': item['note'],
                        }, accent: green),
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFDDF2ED),
                      child: Icon(Icons.payments_outlined, color: green),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});
  @override
  ConsumerState<CustomersScreen> createState() => _CustomersState();
}

class _CustomersState extends ConsumerState<CustomersScreen> {
  String query = '';
  @override
  Widget build(BuildContext context) => ref
      .watch(resourceProvider('customers'))
      .when(
        loading: () => const LoadingCards(),
        error: (e, st) => RetryView(
          error: e,
          onRetry: () => ref.invalidate(resourceProvider('customers')),
        ),
        data: (rows) {
          final filtered = rows
              .where(
                (r) => r.toString().toLowerCase().contains(query.toLowerCase()),
              )
              .toList();
          return ListView(
            padding: const EdgeInsets.all(22),
            children: [
              TextField(
                onChanged: (value) => setState(() => query = value),
                decoration: const InputDecoration(
                  hintText: 'Search customer name or reference',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
              const SizedBox(height: 15),
              if (filtered.isEmpty)
                const EmptyView('No customers in your scope'),
              ...filtered.map(
                (r) => Card(
                  margin: const EdgeInsets.only(bottom: 10),
                  child: ListTile(
                    title: Text(r['name'] ?? ''),
                    subtitle: Text(
                      '${r['mobile']} · ${r['agent']}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: const Icon(
                      Icons.chevron_right,
                      color: Color(0xFF35699C),
                    ),
                    onTap: () =>
                        showRecordDetails(context, 'Customer details', {
                          'Name': r['name'],
                          'Mobile': r['mobile'],
                          'Document': r['document'],
                          'Nationality': r['nationality'],
                          'Agent': r['agent'],
                        }, accent: const Color(0xFF35699C)),
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFE3EDFC),
                      child: Icon(
                        Icons.person_outline,
                        color: Color(0xFF35699C),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      );
}

class DailyReportScreen extends ConsumerWidget {
  const DailyReportScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => ref
      .watch(dashboardProvider)
      .when(
        loading: () => const LoadingCards(),
        error: (e, st) => RetryView(
          error: e,
          onRetry: () => ref.invalidate(dashboardProvider),
        ),
        data: (d) => ListView(
          padding: const EdgeInsets.all(22),
          children: [
            const Text(
              'Today in the field',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  children: [
                    KeyValue('Transactions today', '${d['kyc_today']}'),
                    KeyValue('Awaiting review', '${d['kyc_pending_review']}'),
                    KeyValue('Sales completed', '${d['today']}'),
                    KeyValue('Daily target', '${d['target']}'),
                    KeyValue('Achievement', '${d['achievement']}%'),
                    KeyValue('Available SIMs', '${d['stock']}'),
                    KeyValue(
                      'Recorded incentives this month',
                      'AED ${d['incentive_total']}',
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              'Last synchronized ${shortTime(d['last_sync'])}',
              style: const TextStyle(color: muted),
            ),
          ],
        ),
      );
}

class SupportScreen extends ConsumerStatefulWidget {
  const SupportScreen({super.key});
  @override
  ConsumerState<SupportScreen> createState() => _SupportState();
}

class _SupportState extends ConsumerState<SupportScreen> {
  final subject = TextEditingController(),
      description = TextEditingController();
  bool busy = false;
  @override
  void dispose() {
    subject.dispose();
    description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.read(serviceProvider), data = ref.watch(supportProvider);
    return ListView(
      padding: const EdgeInsets.all(22),
      children: [
        const Text(
          'Ask for field support',
          style: TextStyle(fontSize: 23, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        const Text(
          'Report an operational issue. Avoid customer identity data.',
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: 15),
        TextField(
          controller: subject,
          maxLength: 160,
          decoration: const InputDecoration(labelText: 'Subject'),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: description,
          maxLength: 1000,
          maxLines: 4,
          decoration: const InputDecoration(labelText: 'What happened?'),
        ),
        FilledButton(
          onPressed: busy || s.user?['agent_id'] == null
              ? null
              : () async {
                  setState(() => busy = true);
                  try {
                    await s.dio.post(
                      '/support-tickets',
                      data: {
                        'agent_id': s.user!['agent_id'],
                        'subject': subject.text,
                        'message': description.text,
                      },
                    );
                    subject.clear();
                    description.clear();
                    ref.invalidate(supportProvider);
                    if (context.mounted) {
                      message(context, 'Support request sent');
                    }
                  } catch (e) {
                    if (context.mounted) message(context, friendlyError(e));
                  } finally {
                    if (mounted) setState(() => busy = false);
                  }
                },
          child: const Text('Send support request'),
        ),
        const SizedBox(height: 25),
        const SectionTitle('Request history'),
        const SizedBox(height: 10),
        ...data.when(
          loading: () => <Widget>[
            const SizedBox(height: 220, child: LoadingCards()),
          ],
          error: (e, st) => <Widget>[
            RetryView(error: e, onRetry: () => ref.invalidate(supportProvider)),
          ],
          data: (rows) => rows.isEmpty
              ? <Widget>[const EmptyView('No support requests yet')]
              : rows
                    .map<Widget>(
                      (r) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Card(
                          child: ListTile(
                            title: Text(
                              r['subject'],
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: const Icon(
                              Icons.chevron_right,
                              color: burgundy,
                            ),
                            onTap: () =>
                                showRecordDetails(context, 'Support request', {
                                  'Subject': r['subject'],
                                  'Status': r['status'],
                                  'Message': r['message'],
                                  'Response': r['response']?.isNotEmpty == true
                                      ? r['response']
                                      : 'Awaiting response',
                                }),
                            subtitle: Text(
                              '${r['status']} · ${r['response']?.isNotEmpty == true ? r['response'] : r['message']}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                      ),
                    )
                    .toList(),
        ),
      ],
    );
  }
}

class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});
  @override
  ConsumerState<OrdersScreen> createState() => _OrdersState();
}

class _OrdersState extends ConsumerState<OrdersScreen> {
  String status = 'All', search = '';
  @override
  Widget build(BuildContext context) {
    final data = ref.watch(resourceProvider('activations'));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(22, 24, 22, 16),
          child: Text(
            'Activation records',
            style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 22),
          child: TextField(
            onChanged: (v) => setState(() => search = v),
            decoration: const InputDecoration(
              hintText: 'Search activation, customer, MSISDN',
              prefixIcon: Icon(Icons.search),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          child: Wrap(
            spacing: 7,
            runSpacing: 6,
            children: ['All', 'Draft', 'Processing', 'Completed', 'Failed']
                .map(
                  (s) => ChoiceChip(
                    label: Text(s),
                    selected: status == s,
                    onSelected: (_) {
                      if (s == 'Draft') {
                        context.push('/drafts');
                      } else {
                        setState(() => status = s);
                      }
                    },
                  ),
                )
                .toList(),
          ),
        ),
        Expanded(
          child: data.when(
            loading: () => const LoadingCards(),
            error: (e, st) => RetryView(
              error: e,
              onRetry: () => ref.invalidate(resourceProvider('activations')),
            ),
            data: (rows) {
              final filtered = rows
                  .where(
                    (o) =>
                        (status == 'All' ||
                            o['status'] ==
                                {
                                  'Draft': 'DRAFT',
                                  'Processing': 'PROCESSING',
                                  'Completed': 'ACTIVATED',
                                  'Failed': 'FAILED',
                                }[status]) &&
                        o.toString().toLowerCase().contains(
                          search.toLowerCase(),
                        ),
                  )
                  .toList();
              if (filtered.isEmpty) {
                return const EmptyView('No matching activations');
              }
              return ListView(
                padding: const EdgeInsets.symmetric(horizontal: 22),
                children: filtered.map(OrderCard.new).toList(),
              );
            },
          ),
        ),
      ],
    );
  }
}

class OrderCard extends ConsumerWidget {
  final Json order;
  const OrderCard(this.order, {super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () async {
          try {
            final r = await ref
                .read(serviceProvider)
                .dio
                .get('/activations/${order['id']}');
            if (!context.mounted) return;
            showModalBottomSheet(
              context: context,
              isScrollControlled: true,
              showDragHandle: true,
              builder: (c) => DraggableScrollableSheet(
                expand: false,
                initialChildSize: .75,
                builder: (c, scroll) => ListView(
                  controller: scroll,
                  padding: const EdgeInsets.all(24),
                  children: [
                    Text(
                      order['reference'],
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 14),
                    StatusPill(r.data['status']),
                    const SizedBox(height: 18),
                    ...[
                      'request_id',
                      'sr_id',
                      'msisdn',
                      'customer',
                      'agent',
                      'outlet',
                      'plan',
                    ].map(
                      (key) => KeyValue(
                        key.replaceAll('_', ' '),
                        order[key]?.toString() ?? '—',
                      ),
                    ),
                    const SizedBox(height: 20),
                    const SectionTitle('Activation history'),
                    ...(r.data['events'] as List).map(
                      (e) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(
                          Icons.check_circle_outline,
                          color: green,
                        ),
                        title: Text(
                          e['action'],
                          style: const TextStyle(fontSize: 14),
                        ),
                        subtitle: Text(
                          '${e['actor']} · ${shortTime(e['created_at'])}',
                          style: const TextStyle(fontSize: 11),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          } catch (e) {
            if (context.mounted) message(context, friendlyError(e));
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      order['reference'],
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: burgundy,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  StatusPill(order['status']),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                order['customer'] ?? 'New customer',
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${order['plan']} · ${shortTime(order['created_at'])}',
                style: const TextStyle(fontSize: 11, color: muted),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class StockScreen extends ConsumerStatefulWidget {
  const StockScreen({super.key});
  @override
  ConsumerState<StockScreen> createState() => _StockState();
}

class _StockState extends ConsumerState<StockScreen> {
  String search = '';

  Future<void> updateStock(Map<String, dynamic> sim) async {
    final reason = TextEditingController();
    var busy = false;
    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              title: const Text('Update SIM stock'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    sim['iccid'].toString(),
                    style: const TextStyle(fontSize: 14),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'A reason is required. This movement is recorded in the audit history.',
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: reason,
                    minLines: 2,
                    maxLines: 3,
                    maxLength: 300,
                    decoration: const InputDecoration(
                      labelText: 'Reason (at least 5 characters)',
                    ),
                    onChanged: (_) => setDialogState(() {}),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: busy ? null : () => Navigator.pop(dialogContext),
                  child: const Text('Cancel'),
                ),
                for (final target in ['RETURNED', 'DAMAGED'])
                  TextButton(
                    onPressed: busy || reason.text.trim().length < 5
                        ? null
                        : () async {
                            setDialogState(() => busy = true);
                            try {
                              await ref
                                  .read(serviceProvider)
                                  .dio
                                  .post(
                                    '/inventory/${sim['id']}/move',
                                    data: {
                                      'status': target,
                                      'reason': reason.text.trim(),
                                    },
                                  );
                              ref.invalidate(resourceProvider('inventory'));
                              ref.invalidate(dashboardProvider);
                              if (dialogContext.mounted) {
                                Navigator.pop(dialogContext);
                              }
                              if (mounted) {
                                message(
                                  context,
                                  target == 'RETURNED'
                                      ? 'SIM return recorded'
                                      : 'SIM damage reported',
                                );
                              }
                            } catch (e) {
                              if (dialogContext.mounted) {
                                message(dialogContext, friendlyError(e));
                              }
                            } finally {
                              if (dialogContext.mounted) {
                                setDialogState(() => busy = false);
                              }
                            }
                          },
                    child: Text(
                      target == 'RETURNED' ? 'Return SIM' : 'Report damage',
                    ),
                  ),
              ],
            );
          },
        ),
      );
    } finally {
      reason.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = ref.watch(resourceProvider('inventory'));
    return data.when(
      loading: () => const LoadingCards(),
      error: (e, st) => RetryView(
        error: e,
        onRetry: () => ref.invalidate(resourceProvider('inventory')),
      ),
      data: (rows) {
        final available = rows
            .where((s) => s['status'] == 'AVAILABLE')
            .toList();
        return ListView(
          padding: const EdgeInsets.all(22),
          children: [
            const Text(
              'My SIM stock',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text(
              'Every SIM. Accounted for.',
              style: TextStyle(color: muted),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: MetricTile(
                    'Physical SIM',
                    '${available.where((s) => s['sim_type'] == 'Physical').length}',
                    Icons.sim_card_outlined,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: MetricTile(
                    'eSIM',
                    '${available.where((s) => s['sim_type'] == 'eSIM').length}',
                    Icons.qr_code,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            TextField(
              onChanged: (v) => setState(() => search = v),
              decoration: InputDecoration(
                hintText: search.isEmpty ? 'Search ICCID or serial' : search,
                prefixIcon: const Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 22),
            ...rows
                .where(
                  (s) =>
                      s.toString().toLowerCase().contains(search.toLowerCase()),
                )
                .map(
                  (s) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Card(
                      child: ListTile(
                        onTap:
                            ([
                                  'AVAILABLE',
                                  'ASSIGNED TO AGENT',
                                  'ASSIGNED TO TEAM',
                                ].contains(s['status']) &&
                                ((ref.read(serviceProvider).user?['permissions']
                                                as List?)
                                            ?.contains('inventory.self') ==
                                        true ||
                                    (ref
                                                    .read(serviceProvider)
                                                    .user?['permissions']
                                                as List?)
                                            ?.contains('inventory.write') ==
                                        true))
                            ? () => updateStock(s)
                            : null,
                        contentPadding: const EdgeInsets.all(13),
                        leading: const Icon(
                          Icons.sim_card_outlined,
                          color: burgundy,
                        ),
                        title: Text(
                          s['iccid'],
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Padding(
                          padding: const EdgeInsets.only(top: 7),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              StatusPill(s['status']),
                              if (s['activation_stage'] != null &&
                                  s['activation_stage'] != 'NOT_STARTED')
                                Padding(
                                  padding: const EdgeInsets.only(top: 5),
                                  child: Text(
                                    '${s['activation_stage'].toString().replaceAll('_', ' ')} · Payment ${s['payment_status'].toString().replaceAll('_', ' ').toLowerCase()}',
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: muted,
                                    ),
                                  ),
                                ),
                              if ([
                                'AVAILABLE',
                                'ASSIGNED TO AGENT',
                                'ASSIGNED TO TEAM',
                              ].contains(s['status']))
                                const Padding(
                                  padding: EdgeInsets.only(top: 5),
                                  child: Text(
                                    'Tap to return or report damage',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: muted,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
          ],
        );
      },
    );
  }
}

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(serviceProvider),
        data = ref.watch(resourceProvider('agents'));
    return data.when(
      loading: () => const LoadingCards(),
      error: (e, st) => RetryView(
        error: e,
        onRetry: () => ref.invalidate(resourceProvider('agents')),
      ),
      data: (rows) {
        final a = rows.isEmpty ? <String, dynamic>{} : rows.first;
        return ListView(
          padding: const EdgeInsets.all(22),
          children: [
            const Text(
              'My workspace',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 25),
            CircleAvatar(
              radius: 35,
              backgroundColor: const Color(0xFFF1E5EC),
              child: Text(
                s.user!['name'].substring(0, 1),
                style: const TextStyle(fontSize: 28, color: burgundy),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              s.user!['name'],
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 5),
            Text(
              s.user!['role'],
              textAlign: TextAlign.center,
              style: const TextStyle(color: muted, fontSize: 12),
            ),
            const SizedBox(height: 25),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  children: [
                    KeyValue('Employee ID', a['employee_id'] ?? '—'),
                    KeyValue('Branch', a['branch'] ?? '—'),
                    const KeyValue('Device', 'Relay Flutter'),
                    const KeyValue('App version', '1.0.0'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: s.user!['agent_id'] == null
                  ? null
                  : () async {
                      try {
                        await s.dio.post(
                          '/agents/${a['id']}/shift',
                          data: {
                            'action': a['on_shift'] == true ? 'end' : 'start',
                          },
                        );
                        ref.invalidate(resourceProvider('agents'));
                        ref.invalidate(dashboardProvider);
                      } catch (e) {
                        if (context.mounted) message(context, friendlyError(e));
                      }
                    },
              icon: const Icon(Icons.access_time),
              label: Text(a['on_shift'] == true ? 'End shift' : 'Start shift'),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () async {
                await s.sync();
                if (context.mounted) {
                  message(context, s.syncError ?? 'Synchronization complete');
                }
              },
              icon: const Icon(Icons.sync),
              label: Text(
                s.syncing ? 'Syncing…' : 'Sync now · ${s.queued} pending',
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => showDialog(
                context: context,
                builder: (c) => AlertDialog(
                  title: const Text('Connection status'),
                  content: Text(
                    'Connection: ${s.online ? 'Connected' : 'Offline'}\nPending updates: ${s.queued}\n${s.syncError ?? 'Up to date'}',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(c),
                      child: const Text('Close'),
                    ),
                  ],
                ),
              ),
              icon: const Icon(Icons.health_and_safety_outlined),
              label: const Text('Connection status'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
            const SizedBox(height: 15),
            TextButton.icon(
              onPressed: () async {
                try {
                  await s.logout();
                } catch (e) {
                  if (context.mounted) message(context, friendlyError(e));
                }
              },
              icon: const Icon(Icons.logout),
              label: const Text('Sign out'),
            ),
            const SizedBox(height: 18),
            InfoCard(
              icon: Icons.lock_outline,
              text: s.isPreview
                  ? 'Your field workspace.'
                  : 'Your workspace is shared with your assigned branch.',
            ),
          ],
        );
      },
    );
  }
}

class StatusPill extends StatelessWidget {
  final String status;
  const StatusPill(this.status, {super.key});
  @override
  Widget build(BuildContext context) {
    final good = [
          'ACTIVATED',
          'VERIFIED',
          'AVAILABLE',
          'IN BOUNDS',
          'ACTIVE SHIFT',
        ].contains(status),
        bad = ['FAILED', 'DAMAGED', 'OUT OF BOUNDS'].contains(status);
    final color = good
        ? green
        : bad
        ? const Color(0xFFC64451)
        : const Color(0xFFAD8233);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        status.replaceAll('_', ' '),
        style: TextStyle(
          fontSize: 11,
          color: color,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class MetricTile extends StatelessWidget {
  final String label, value;
  final IconData icon;
  final Color accent;
  final VoidCallback? onTap;
  const MetricTile(
    this.label,
    this.value,
    this.icon, {
    super.key,
    this.accent = burgundy,
    this.onTap,
  });
  @override
  Widget build(BuildContext context) => EnterSurface(
    child: Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(17),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                accent.withValues(alpha: .18),
                accent.withValues(alpha: .04),
              ],
            ),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: accent.withValues(alpha: .18)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      label,
                      style: const TextStyle(
                        fontSize: 13,
                        color: muted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      color: accent.withValues(alpha: .16),
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Icon(icon, size: 18, color: accent),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 29,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -1,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

Future<void> showRecordDetails(
  BuildContext context,
  String title,
  Map<String, dynamic> fields, {
  Color accent = burgundy,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    backgroundColor: const Color(0xFFFAF8FD),
    builder: (sheetContext) => ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(sheetContext).height * .82,
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(22, 0, 22, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      color: accent,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Close details',
                  onPressed: () => Navigator.pop(sheetContext),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            ...fields.entries.map(
              (entry) => KeyValue(entry.key, (entry.value ?? '—').toString()),
            ),
          ],
        ),
      ),
    ),
  );
}

class SectionTitle extends StatelessWidget {
  final String text;
  const SectionTitle(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Text(
    text,
    style: const TextStyle(
      fontSize: 17,
      fontWeight: FontWeight.w700,
      color: ink,
    ),
  );
}

class KeyValue extends StatelessWidget {
  final String label, value;
  const KeyValue(this.label, this.value, {super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontSize: 14, color: muted),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
          ),
        ),
      ],
    ),
  );
}

class InfoCard extends StatelessWidget {
  final IconData icon;
  final String text;
  const InfoCard({super.key, required this.icon, required this.text});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(15),
    decoration: BoxDecoration(
      color: const Color(0xFFF2EAF0),
      borderRadius: BorderRadius.circular(10),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: burgundy, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              fontSize: 11,
              color: Color(0xFF90667D),
              height: 1.6,
            ),
          ),
        ),
      ],
    ),
  );
}

class LoadingCards extends StatelessWidget {
  const LoadingCards({super.key});
  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(22),
    children: List.generate(
      4,
      (_) => Container(
        height: 120,
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: const Color(0xFFECEEF2),
          borderRadius: BorderRadius.circular(14),
        ),
      ),
    ),
  );
}

class EmptyView extends StatelessWidget {
  final String text;
  const EmptyView(this.text, {super.key});
  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.inbox_outlined, color: muted, size: 40),
        const SizedBox(height: 15),
        Text(text, style: const TextStyle(color: muted)),
      ],
    ),
  );
}

class RetryView extends StatelessWidget {
  final Object error;
  final VoidCallback onRetry;
  const RetryView({super.key, required this.error, required this.onRetry});
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(25),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(friendlyError(error), textAlign: TextAlign.center),
          const SizedBox(height: 18),
          OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
        ],
      ),
    ),
  );
}

String shortTime(dynamic value) {
  final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
  if (date == null) return '—';
  return '${date.day}/${date.month} · ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

void message(BuildContext context, String text) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
