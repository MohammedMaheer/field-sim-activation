import 'package:flutter/material.dart';

const appName = 'Qanawat';
const companyName = 'Qanawat Connect Solutions LLC';
const qanawatLogoAsset = 'assets/branding/qanawat-logo.png';
const qanawatMarkAsset = 'assets/branding/qanawat-mark.png';

/// The supplied company artwork, with a readable surface for dark headers.
class QanawatBrand extends StatelessWidget {
  const QanawatBrand({
    super.key,
    this.width = 160,
    this.height,
    this.darkSurface = false,
  });

  final double width;
  final double? height;
  final bool darkSurface;

  @override
  Widget build(BuildContext context) {
    final logo = Image.asset(
      qanawatLogoAsset,
      width: width,
      height: height ?? width * 89 / 312,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
    );
    return Semantics(
      label: companyName,
      image: true,
      child: ExcludeSemantics(
        child: darkSurface
            ? DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Padding(padding: const EdgeInsets.all(5), child: logo),
              )
            : logo,
      ),
    );
  }
}
