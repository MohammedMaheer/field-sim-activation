import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/saved_drafts.dart';
import 'package:relay_agent/services.dart';

class RecoveryStore extends OfflineStore {
  final values = <String, Json>{};
  @override
  Future<Json?> get(String id) async => values[id];
  @override
  Future<void> put(String id, Json value) async => values[id] = value;
}

class RecoveryService extends RelayService {
  final memory = RecoveryStore();
  @override
  OfflineStore get store => memory;
}

void main() {
  test(
    'lost committed response queues locally and recovers the same server draft',
    () async {
      final service = RecoveryService()..user = {'id': 'agent-one'};
      Json? committed;
      var posts = 0;
      service.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (request, handler) {
            if (request.method == 'POST') {
              posts++;
              final details = Json.from(request.data['data']);
              committed = {
                'id': 'server-draft',
                'data': {...details, 'saved_draft_id': 'server-draft'},
              };
              if (posts == 1) {
                handler.reject(
                  DioException.connectionError(
                    requestOptions: request,
                    reason: 'Response lost after commit',
                  ),
                );
                return;
              }
            }
            handler.resolve(
              Response(
                requestOptions: request,
                statusCode: 200,
                data: request.method == 'POST' ? committed : [committed],
              ),
            );
          },
        ),
      );
      final local = await saveSavedDraft(service, {
        'transaction_id': 'same-transaction',
        'name': 'Retained customer',
        'document_image': 'synthetic-photo',
      });
      expect(local['pending'], isTrue);
      expect(local['id'], isNot('server-draft'));
      final recovered = await loadSavedDrafts(service);
      expect(posts, 2);
      expect(recovered, hasLength(1));
      expect(recovered.single['id'], 'server-draft');
      expect(recovered.single['pending'], isNull);
      expect(recovered.single['data']['document_image'], 'synthetic-photo');
      final cache = await service.store.get(savedDraftsKey(service));
      expect(cache!['rows'], hasLength(1));
      expect(cache['rows'].single['id'], 'server-draft');
    },
  );

  test(
    'permission refusal is shown and never converted into an offline saved draft',
    () async {
      final service = RecoveryService()..user = {'id': 'revoked-agent'};
      service.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (request, handler) {
            handler.reject(
              DioException(
                requestOptions: request,
                response: Response(
                  requestOptions: request,
                  statusCode: 403,
                  data: {'detail': 'Capture access removed'},
                ),
              ),
            );
          },
        ),
      );
      await expectLater(
        saveSavedDraft(service, {'transaction_id': 'denied'}),
        throwsA(isA<DioException>()),
      );
      expect(await service.store.get(savedDraftsKey(service)), isNull);
    },
  );
}
